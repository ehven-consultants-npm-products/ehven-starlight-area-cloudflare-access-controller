import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
export default defineConfig({
  site: 'https://example.org',
  integrations: [starlight({ title: 'Access integration fixture', components: { Sidebar: './src/components/Sidebar.astro' } })],
});
