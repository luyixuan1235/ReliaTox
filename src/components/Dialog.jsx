import { useEffect, useId, useRef } from 'react'
import { IconClose } from '../icons.jsx'

export default function Dialog({ title, onClose, children, className = '' }) {
  const ref = useRef(null)
  const opener = useRef(document.activeElement)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    const previousFocus = opener.current
    return () => {
      dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  return (
    <dialog ref={ref} className={`dialog-shell ${className}`} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return
        const elements = [...ref.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter((el) => el.getClientRects().length)
        const first = elements[0]
        const last = elements.at(-1)
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }}>
      <div className="modal">
        <h3 id={titleId}>{title}</h3>
        {children}
        <button className="icon-btn modal-close" type="button" onClick={onClose} aria-label="关闭弹窗"><IconClose /></button>
      </div>
    </dialog>
  )
}
