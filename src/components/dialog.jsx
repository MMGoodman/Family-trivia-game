import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

// דיאלוגים מעוצבים במקום confirm/prompt של הדפדפן.
// שימוש: const ok = await confirmDialog({...}) / const val = await promptDialog({...})

function openDialog(render) {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const close = (value) => {
      root.unmount()
      host.remove()
      resolve(value)
    }
    root.render(render(close))
  })
}

function Shell({ onCancel, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog-card" dir="rtl">
        {children}
      </div>
    </div>
  )
}

export function confirmDialog({
  title,
  message,
  confirmText = 'אישור',
  cancelText = 'ביטול',
  danger = false,
}) {
  return openDialog((close) => (
    <Shell onCancel={() => close(false)}>
      <h3>{title}</h3>
      {message && <div className="dialog-msg">{message}</div>}
      <div className="dialog-actions">
        <button autoFocus className={danger ? 'danger-solid' : 'primary'} onClick={() => close(true)}>
          {confirmText}
        </button>
        <button className="ghost" onClick={() => close(false)}>
          {cancelText}
        </button>
      </div>
    </Shell>
  ))
}

function PromptCard({ title, message, defaultValue, confirmText, cancelText, inputMode, close }) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <Shell onCancel={() => close(null)}>
      <form
        className="col"
        style={{ gap: '1rem' }}
        onSubmit={(e) => {
          e.preventDefault()
          close(value)
        }}
      >
        <h3>{title}</h3>
        {message && <div className="dialog-msg">{message}</div>}
        <input
          ref={inputRef}
          inputMode={inputMode}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="dialog-actions">
          <button type="submit" className="primary">
            {confirmText}
          </button>
          <button type="button" className="ghost" onClick={() => close(null)}>
            {cancelText}
          </button>
        </div>
      </form>
    </Shell>
  )
}

// מחזיר את הטקסט שהוקלד, או null אם בוטל
export function promptDialog({
  title,
  message,
  defaultValue = '',
  confirmText = 'שמירה',
  cancelText = 'ביטול',
  inputMode,
}) {
  return openDialog((close) => (
    <PromptCard
      title={title}
      message={message}
      defaultValue={defaultValue}
      confirmText={confirmText}
      cancelText={cancelText}
      inputMode={inputMode}
      close={close}
    />
  ))
}
