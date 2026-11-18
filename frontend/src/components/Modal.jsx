import { useEffect } from 'react'

// 알림창: actions = [{ label, onClick, primary }]. 버튼이 없으면 '확인' 하나로 닫기
export default function Modal({ title, children, actions, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const buttons = actions?.length ? actions : [{ label: '확인', onClick: onClose, primary: true }]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          {buttons.map((b, i) => (
            <button
              key={b.label}
              className={b.primary ? 'btn primary' : 'btn ghost'}
              onClick={b.onClick}
              autoFocus={i === buttons.length - 1}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
