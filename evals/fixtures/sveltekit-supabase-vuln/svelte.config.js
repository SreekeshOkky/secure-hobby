import adapter from '@sveltejs/adapter-vercel';

export default {
  kit: { adapter: adapter(), csrf: { checkOrigin: false } },
};
