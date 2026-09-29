import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme-without-fonts';

// After the default theme, so that style.css overrides its variables.
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './style.css';

import ArchDiagram from './components/ArchDiagram.vue';
import ConfigBuilder from './components/ConfigBuilder.vue';
import HomePage from './components/HomePage.vue';
import PerfChart from './components/PerfChart.vue';
import Screenshot from './components/Screenshot.vue';
import SyncStatus from './components/SyncStatus.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // Used directly in the Markdown pages.
    app.component('ArchDiagram', ArchDiagram);
    app.component('ConfigBuilder', ConfigBuilder);
    app.component('HomePage', HomePage);
    app.component('PerfChart', PerfChart);
    app.component('Screenshot', Screenshot);
    app.component('SyncStatus', SyncStatus);
  },
} satisfies Theme;
