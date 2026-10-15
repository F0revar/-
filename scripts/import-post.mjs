import { runCollection } from './collect.mjs';
const url = process.argv[2] || process.env.POST_URL;
if (!url) { console.error('用法：npm run import -- https://x.com/thsottiaux/status/帖子ID'); process.exitCode = 1; }
else await runCollection({ importedUrl: url });
