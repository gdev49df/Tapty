// Голосовые сообщения: запись с микрофона и проигрывание в диалоге.
import { LIMITS } from './catalog.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { esc } from './ui.js';

// Сначала то, что проиграется на любом телефоне (AAC), затем то, что умеет записать этот браузер.
const TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

export const canRecord = () => Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// Включает микрофон и пишет, пока не вызван stop() или не вышло время. Микрофон выключается сразу после записи.
export async function startRecording({ onTick, onEnd }) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  let recorder;
  try {
    const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 32000 });
    recorder.start();
  } catch (e) {
    release();
    throw e;
  }
  const started = performance.now();
  const passed = () => (performance.now() - started) / 1000;
  const chunks = [];
  let seconds = 0;
  let timer = 0;
  const measure = () => {
    seconds ||= Math.min(LIMITS.voiceSeconds, Math.max(1, Math.round(passed())));
    clearInterval(timer);
  };
  const done = new Promise((resolve) => {
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      measure();
      release();
      resolve({ blob: new Blob(chunks, { type: recorder.mimeType }), seconds });
      onEnd();
    };
  });
  const stop = () => {
    if (recorder.state !== 'inactive') {
      measure();
      recorder.stop();
    }
    return done;
  };
  timer = setInterval(() => {
    onTick(Math.min(passed(), LIMITS.voiceSeconds));
    if (passed() >= LIMITS.voiceSeconds) stop();
  }, 200);
  return { stop };
}

export const voiceHtml = (message) => `<div class="voice" data-voice="${esc(message.voice)}" data-seconds="${message.seconds}">
  <button type="button" data-play aria-label="${esc(t('voicePlay'))}">${icon('play')}</button>
  <progress max="1" value="0" aria-hidden="true"></progress>
  <span>${clock(message.seconds)}</span>
</div>`;

// Один плеер на диалог: список сообщений перерисовывается, а запись продолжает играть.
export function createPlayer(root, load, onError) {
  const audio = new Audio();
  let current = '';
  let wanted = '';

  const paint = () => {
    for (const box of root.querySelectorAll('[data-voice]')) {
      const on = box.dataset.voice === current;
      const playing = on && !audio.paused;
      const seconds = Number(box.dataset.seconds);
      // длительность берём из сообщения: у части записей браузер её не знает
      const at = on ? Math.min(audio.currentTime, seconds) : 0;
      const button = box.querySelector('button');
      if (button.dataset.playing !== String(playing)) {
        button.dataset.playing = playing;
        button.innerHTML = icon(playing ? 'pause' : 'play');
        button.setAttribute('aria-label', t(playing ? 'voicePause' : 'voicePlay'));
      }
      box.querySelector('progress').value = at / seconds;
      box.querySelector('span').textContent = clock(playing || at ? at : seconds);
    }
  };
  for (const name of ['play', 'pause', 'timeupdate']) audio.addEventListener(name, paint);
  audio.addEventListener('ended', () => {
    audio.currentTime = 0;
    paint();
  });

  root.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-play]')?.closest('[data-voice]').dataset.voice;
    if (!id) return;
    try {
      if (id === current) {
        if (audio.paused) await audio.play();
        else audio.pause();
        return;
      }
      wanted = id;
      audio.pause();
      const url = await load(id);
      // пока скачивалось, могли нажать на другую запись
      if (wanted !== id || current === id) return;
      current = id;
      audio.src = url;
      paint();
      await audio.play();
    } catch (err) {
      // iPhone не даёт начать звук после скачивания: запись уже здесь, второе нажатие сыграет сразу
      if (err.name === 'NotAllowedError' || err.name === 'AbortError') return;
      current = '';
      paint();
      onError(err);
    }
  });

  return {
    paint,
    pause: () => {
      wanted = '';
      audio.pause();
    },
  };
}
