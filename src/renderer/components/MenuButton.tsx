import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}

/** Button that opens a small action menu (portal, closes on outside click / Esc). */
export function MenuButton({
  items,
  label,
  children,
  className = 'icon-btn'
}: {
  items: MenuItem[];
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && (menuRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node))) return;
      setPos(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) return setPos(null);
    const r = buttonRef.current!.getBoundingClientRect();
    const menuWidth = 230;
    const menuHeight = items.length * 36 + 16;
    const x = Math.min(window.innerWidth - menuWidth - 8, Math.max(8, r.right - menuWidth));
    const below = r.bottom + 6;
    const y = below + menuHeight > window.innerHeight - 8 ? Math.max(8, r.top - menuHeight - 6) : below;
    setPos({ x, y });
  };

  return (
    <>
      <button ref={buttonRef} className={className} aria-label={label} aria-haspopup="menu" aria-expanded={!!pos} onClick={toggle} onDoubleClick={(e) => e.stopPropagation()}>
        {children ?? <Icon name="more" />}
      </button>
      {pos &&
        createPortal(
          <div ref={menuRef} className="menu" role="menu" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            {items.map((item) => (
              <Fragment key={item.label}>
                {item.separatorBefore && <hr />}
                <button
                  role="menuitem"
                  className={item.danger ? 'danger' : undefined}
                  onClick={() => {
                    setPos(null);
                    item.onSelect();
                  }}
                >
                  <Icon name={item.icon} size={16} />
                  {item.label}
                </button>
              </Fragment>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
