export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    // Keep fallback inside the topmost modal; body is inert beneath word/letter dialogs.
    const parent = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
    const input = document.createElement('textarea');
    input.value = text; input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    parent.append(input); input.select();
    try { if (!document.execCommand('copy')) throw new Error('Copy unavailable'); }
    finally { input.remove(); }
  }
}
