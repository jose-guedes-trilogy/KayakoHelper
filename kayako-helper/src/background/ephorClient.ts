/* Kayako Helper – ephorClient.ts (rev-v5.2.1)
   ------------------------------------------------
   Compatibility re-export.  No business logic here.

   ⚠️  Important: leave the file-extensions OFF in the
   import paths so Rollup’s node-resolver can locate
   the transpiled .js outputs.
*/

export * from "./ephor-client/EphorClient";
export { hiddenFetch }     from "./ephor-client/hiddenFetch";
export { HiddenEphorTab }  from "./ephor-client/HiddenEphorTab";
export { hiddenEphorTabId } from "./ephor-client/EphorClient";

/* side-effect import – registers SW message listeners */
import "./ephor-client/backgroundListeners";
