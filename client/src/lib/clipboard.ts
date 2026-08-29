/**
 * Copy text to the clipboard. navigator.clipboard often fails on
 * http://LAN_IP (non-secure context); fall back to execCommand, then prompt.
 */
export async function copyToClipboard(text: string): Promise<'copied' | 'prompted' | 'failed'> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return 'copied'
    }
  } catch {
    // fall through
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.width = '1px'
    ta.style.height = '1px'
    ta.style.padding = '0'
    ta.style.border = 'none'
    ta.style.outline = 'none'
    ta.style.boxShadow = 'none'
    ta.style.background = 'transparent'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (ok) return 'copied'
  } catch {
    // fall through
  }

  // Last resort: user can Ctrl+C from the dialog
  window.prompt('Copy this link (Ctrl+C, then Enter):', text)
  return 'prompted'
}
