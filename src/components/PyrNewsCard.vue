<script setup lang="ts">
/**
 * Pyr news, asked once (Ames 2026-11-05): on a player's first visit after
 * they are in (invited or let in), a small Nurro card asks whether they would
 * like very occasional news from Pyr by email. Yes or No thanks is final.
 * Closing it without answering leaves the question for the bell a few
 * minutes after the Five Days Achievement (pyr_news.ts).
 */
import { ref, watch } from 'vue';
import { useProofreadingBackendStore } from '../store';
import { betaGate } from '../beta_gate';
import { untilQuiet } from '../util/toolbar_staging';
import { newsStatus, answerNews, NEWS_LINE } from '../pyr_news';
import imgNurro from '../../static/nurro/nurro-success.png';

const backend: any = useProofreadingBackendStore();
const show = ref(false);
const busy = ref(false);
const done = ref<'' | 'yes' | 'no'>('');
const error = ref('');
const CLOSED = (id: string) => `nge-pyr-news-card-closed:${id}`;
let checkedFor = '';

async function check() {
  const id = String(backend.userId || '');
  if (!id || betaGate.value !== 'in' || checkedFor === id) return;
  checkedFor = id;
  try { if (localStorage.getItem(CLOSED(id))) return; } catch { /* ask anyway */ }
  try {
    const s = await newsStatus();
    if (s.answer || s.onList) return;
  } catch { return; /* asked again next visit */ }
  await untilQuiet();
  show.value = true;
}
watch([() => backend.userId, () => betaGate.value], () => { void check(); }, { immediate: true });

async function answer(yes: boolean) {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try {
    await answerNews(yes, 'card');
    done.value = yes ? 'yes' : 'no';
    setTimeout(() => { show.value = false; }, yes ? 3500 : 1200);
  } catch (e: any) {
    error.value = e?.message || 'That did not go through. Please try again.';
  } finally {
    busy.value = false;
  }
}
function close() {
  show.value = false;
  try { localStorage.setItem(CLOSED(String(backend.userId || '')), new Date().toISOString()); } catch { /* fine */ }
}
</script>

<template>
  <transition name="nge-news-card">
    <div v-if="show" class="ng-extend nge-news-card" role="dialog" aria-labelledby="nge-news-card-title">
      <button class="nge-news-x" aria-label="Close" @click="close">×</button>
      <img :src="imgNurro" alt="" class="nge-news-nurro" />
      <div class="nge-news-body">
        <div class="nge-news-who">Nurro</div>
        <template v-if="!done">
          <p id="nge-news-card-title" class="nge-news-q">Would you like Pyr news by email?</p>
          <p class="nge-news-text">{{ NEWS_LINE }}</p>
          <div class="nge-news-actions">
            <button class="nge-hud-btn" :disabled="busy" @click="answer(true)">{{ busy ? 'Adding…' : 'Yes, add me' }}</button>
            <button class="nge-hud-btn nge-hud-btn--quiet" :disabled="busy" @click="answer(false)">No thanks</button>
          </div>
          <p v-if="error" class="nge-news-error" role="alert">{{ error }}</p>
        </template>
        <p v-else-if="done === 'yes'" class="nge-news-q" role="status">You're on the list! You can change this any time in Settings.</p>
        <p v-else class="nge-news-q" role="status">No problem. It's in Settings if you change your mind.</p>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.nge-news-card {
  position: fixed;
  top: 58px;
  right: 16px;
  z-index: 9400;
  width: 340px;
  max-width: calc(100vw - 32px);
  display: flex;
  gap: 12px;
  padding: 14px 16px 14px 12px;
  border-radius: 10px;
  border: 1px solid rgba(74, 150, 224, 0.4);
  background: rgba(8, 13, 24, 0.96);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55), 0 0 40px rgba(74, 150, 224, 0.12);
  color: rgba(226, 238, 251, 0.92);
  font-family: 'Roboto', 'Inter', sans-serif;
  font-size: 14px;
  line-height: 1.45;
}
.nge-news-x {
  position: absolute; top: 6px; right: 8px;
  border: 0; background: none; color: rgba(226, 238, 251, 0.6);
  font-size: 20px; line-height: 1; cursor: pointer; padding: 4px;
}
.nge-news-x:hover, .nge-news-x:focus-visible { color: #fff; }
.nge-news-nurro { width: 72px; height: 72px; object-fit: contain; flex: none; }
.nge-news-body { min-width: 0; display: flex; flex-direction: column; gap: 8px; padding-right: 10px; }
.nge-news-who {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #7ecaff;
}
.nge-news-q { margin: 0; font-weight: 600; color: #eaf6ff; }
.nge-news-text { margin: 0; color: rgba(226, 238, 251, 0.8); }
.nge-news-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.nge-news-error { margin: 0; color: #ff9b9b; font-size: 13px; }
.nge-news-card-enter-active { transition: opacity 0.35s ease, transform 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
.nge-news-card-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.nge-news-card-enter-from, .nge-news-card-leave-to { opacity: 0; transform: translateY(-10px); }
@media (prefers-reduced-motion: reduce) {
  .nge-news-card-enter-active, .nge-news-card-leave-active { transition: opacity 0.2s; }
  .nge-news-card-enter-from, .nge-news-card-leave-to { transform: none; }
}
</style>
