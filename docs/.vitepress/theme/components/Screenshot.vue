<script setup lang="ts">
// A real screenshot of the admin app in the reader's language and theme.
// Both theme variants are lazy images, so the hidden one is never fetched.
// Clicking opens it full size in a native <dialog>.
import { withBase } from 'vitepress';
import { computed, ref } from 'vue';
import { useLang } from '../i18n';

type Scene = 'dashboard' | 'detail' | 'mobile' | 'setup';

const props = defineProps<{
  name: Scene;
  alt: string;
  /** The scene to show on narrow screens, where this one would be too small to read. */
  narrow?: Scene;
  /** Near the top of the page: fetch it before other images. */
  priority?: boolean;
}>();

// CSS pixels of each capture (the files are 2x).
const sizes = { dashboard: [1280, 800], detail: [1280, 860], mobile: [390, 844], setup: [560, 760] } as const;
const NARROW = '(max-width: 640px)';

const { lang, pick } = useLang();
const src = (theme: 'light' | 'dark', scene: Scene = props.name) => withBase(`/screenshots/${scene}-${theme}-${lang.value}.png`);
const size = computed(() => sizes[props.name]);
const dialog = ref<HTMLDialogElement>();
const open = () => dialog.value?.showModal();
</script>

<template>
  <figure class="sn-shot" :class="[name, narrow && `narrow-${narrow}`]">
    <button type="button" class="frame" :aria-label="pick('放大查看：', 'View larger: ') + alt" @click="open">
      <picture v-for="theme in ['light', 'dark'] as const" :key="theme" :class="`only-${theme}`">
        <source v-if="narrow" :media="NARROW" :srcset="src(theme, narrow)" :width="sizes[narrow][0]" :height="sizes[narrow][1]" />
        <img
          :src="src(theme)"
          :alt="alt"
          :width="size[0]"
          :height="size[1]"
          loading="lazy"
          :fetchpriority="priority ? 'high' : undefined"
          decoding="async"
        />
      </picture>
    </button>
    <figcaption v-if="$slots.default"><slot /></figcaption>
    <dialog ref="dialog" class="zoom" :aria-label="alt" @click="dialog?.close()">
      <picture v-for="theme in ['light', 'dark'] as const" :key="theme" :class="`only-${theme}`">
        <source v-if="narrow" :media="NARROW" :srcset="src(theme, narrow)" :width="sizes[narrow][0]" :height="sizes[narrow][1]" />
        <img :src="src(theme)" :alt="alt" :width="size[0]" :height="size[1]" loading="lazy" />
      </picture>
      <form method="dialog"><button class="close">{{ pick('关闭', 'Close') }}</button></form>
    </dialog>
  </figure>
</template>

<style>
.sn-shot {
  margin: 28px 0;
}

.sn-shot .frame {
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid var(--sn-line);
  border-radius: 12px;
  background: var(--sn-canvas);
  box-shadow: 0 1px 2px rgb(28 27 25 / 0.04), 0 18px 40px -24px rgb(28 27 25 / 0.28);
  overflow: hidden;
  cursor: zoom-in;
  transition: border-color 0.18s var(--sn-ease);
}

.dark .sn-shot .frame {
  box-shadow: 0 18px 40px -24px rgb(0 0 0 / 0.8);
}

.sn-shot .frame:hover {
  border-color: var(--sn-line-2);
}

.sn-shot .frame:focus-visible {
  outline: 2px solid var(--sn-accent);
  outline-offset: 3px;
}

.sn-shot picture,
.sn-shot img {
  display: block;
  width: 100%;
  height: auto;
}

.dark .sn-shot .only-light,
html:not(.dark) .sn-shot .only-dark {
  display: none;
}

.sn-shot.mobile,
.sn-shot.setup {
  max-width: 340px;
}

.sn-shot.mobile .frame {
  border-radius: 22px;
}

@media (max-width: 640px) {
  .sn-shot.narrow-mobile {
    max-width: 300px;
    margin-inline: auto;
  }

  .sn-shot.narrow-mobile .frame {
    border-radius: 22px;
  }
}

.sn-shot figcaption {
  margin-top: 10px;
  color: var(--sn-text-3);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}

.sn-shot .zoom {
  width: min(96vw, 1600px);
  max-width: none;
  max-height: 94vh;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  overflow: visible;
  cursor: zoom-out;
}

.sn-shot.mobile .zoom,
.sn-shot.setup .zoom {
  width: min(92vw, 460px);
}

@media (max-width: 640px) {
  .sn-shot.narrow-mobile .zoom {
    width: min(92vw, 460px);
  }
}

.sn-shot .zoom::backdrop {
  background: rgb(17 17 16 / 0.72);
  backdrop-filter: blur(4px);
}

.sn-shot .zoom img {
  max-height: 94vh;
  border-radius: 12px;
  object-fit: contain;
}

.sn-shot .zoom .close {
  position: fixed;
  top: 16px;
  right: 16px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.14);
  color: #fff;
  font-size: 13px;
}

.sn-shot .zoom[open] {
  animation: sn-zoom 0.22s var(--sn-ease);
}

@keyframes sn-zoom {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}
</style>
