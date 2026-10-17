// Brand tokens shared by every email template. No runtime dependencies, so the pure
// template builders can be unit-tested outside Deno.

// Must be a public URL: mail clients can't load images from localhost or the app bundle.
export const LOGO = "https://www.fylloai.com/fyllo-mark.png";
export const PURPLE = "#8A2BE2";
export const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
