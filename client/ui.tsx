import { useEffect, useRef, ReactNode } from "react";
export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9",
    chat: "M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z",
    folder: "M3 7h7l2-3h8v16H3ZM3 7v13",
    search: "M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    plus: "M12 4v16M4 12h16",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2Z",
    book: "M4 3h6v18H4ZM14 3h6v18h-6",
    user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 22v-3a8 8 0 0 1 16 0v3",
    panel: "M3 4h18v16H3ZM9 4v16",
    chevron: "m9 5 7 7-7 7",
    edit: "m15 4 5 5M4 20l1-6L17 2l5 5L10 19Z",
    logout: "M10 3H3v18h7M8 12h13m-5-5 5 5-5 5",
    pin: "m7 3 10 0-1 6 4 4H4l4-4ZM12 13v9",
    close: "m5 5 14 14M5 19 19 5",
  };
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.chat} />
    </svg>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
