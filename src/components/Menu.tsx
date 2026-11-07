import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface MenuPosition { x: number; y: number; anchorLeft?: number }

interface Props {
  children: ReactNode;
  className: string;
  label: string;
  onClose: () => void;
  position?: MenuPosition;
  submenu?: boolean;
}

function menuItems(menu: HTMLElement) {
  return [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')]
    .filter((item) => item.closest('[role="menu"]') === menu);
}

export function Menu({ children, className, label, onClose, position, submenu = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = menuItems(menu);
    items.forEach((item) => { item.tabIndex = -1; });
    items[0]?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected && (menu.contains(document.activeElement) || document.activeElement === document.body)) {
        previous.focus();
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!position) return;
    const menu = ref.current!;
    const place = () => {
      const { width, height } = menu.getBoundingClientRect();
      const rightEdge = window.innerWidth - width - 8;
      const x = position.anchorLeft !== undefined && position.x > rightEdge
        ? position.anchorLeft - width : position.x;
      menu.style.left = `${Math.max(8, Math.min(x, rightEdge))}px`;
      menu.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - height - 8))}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [position]);

  return <div ref={ref} className={className} role="menu" aria-label={label}
    style={position ? { left: position.x, top: position.y } : undefined}
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      if (event.key === "Tab") {
        onClose();
        return;
      }
      if ((event.target as HTMLElement).closest('[role="menu"]') !== event.currentTarget) return;
      const items = menuItems(event.currentTarget);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape" || (submenu && event.key === "ArrowLeft")) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>{children}</div>;
}

export function MenuSubmenu({ title, children }: { title: string; children: ReactNode }) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = () => {
    const button = trigger.current!;
    const existing = button.parentElement?.querySelector<HTMLElement>('[role="menu"]');
    if (existing) {
      menuItems(existing)[0]?.focus();
      return;
    }
    const rect = button.getBoundingClientRect();
    setPosition({ x: rect.right, y: rect.top, anchorLeft: rect.left });
  };
  return <div className="editor-context-menu-submenu" role="none"
    onMouseEnter={() => { if (!position) open(); }}
    onMouseLeave={() => setPosition(null)}>
    <button ref={trigger} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={position !== null}
      onClick={open} onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          open();
        }
      }}>{title}</button>
    {position && <Menu className="editor-context-menu" label={title} position={position} submenu
      onClose={() => setPosition(null)}>{children}</Menu>}
  </div>;
}
