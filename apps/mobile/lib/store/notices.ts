// User-facing notice strings for non-fatal degradations (a save failed, a
// model didn't load). Kept as pure functions of the language so they can be
// unit-tested without the store, and localized IT/EN like the rest of the app.
//
// A "notice" is distinct from a hard `error`: the turn SUCCEEDED but something
// degraded. It is shown in a dismissible, auto-clearing amber banner rather
// than the red error banner. See chat-store's `notice` channel and NoticeBanner.

import type { Language } from "../orchestrator/types";

// A persistence write failed. The in-memory state is correct, but the SQLite
// copy is not — so the affected message/result may be lost on restart. We warn
// rather than block: nothing the user did is wrong, and retrying isn't theirs
// to drive.
export function persistFailureNotice(lang: Language): string {
  return lang === "it"
    ? "Salvataggio non riuscito: questo messaggio potrebbe andare perso al riavvio."
    : "Couldn't save to storage: this message may be lost if you restart.";
}

// A model is selected but failed to load at startup (e.g. a transient
// low-memory boot). Distinct from "no model installed" — the file is there, it
// just didn't load — so the message points at retrying, not downloading.
export function modelLoadFailureNotice(lang: Language, modelName: string): string {
  return lang === "it"
    ? `Impossibile caricare ${modelName} — apri Modelli per riprovare.`
    : `Couldn't load ${modelName} — open Models to retry.`;
}
