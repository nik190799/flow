// Serves the reference app:  npm run example   then open the printed address.
import { serve } from "../../tools/serve.mjs";
const s = serve("examples/workorders/index.html", Number(process.env.PORT ?? 8787));
s.on("listening", () => console.log(`Work orders is at http://127.0.0.1:${s.address().port}/`));
