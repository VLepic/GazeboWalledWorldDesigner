import { useRef } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";

export interface FloatingWindowPosition {
  horizontal: "left" | "right";
  vertical: "top" | "bottom";
  offsetX: number;
  offsetY: number;
}

interface FloatingWindowProps {
  title: string;
  kicker?: string;
  position: FloatingWindowPosition;
  width?: number;
  children: ReactNode;
  onPositionChange: (position: FloatingWindowPosition) => void;
}

export function FloatingWindow({
  title,
  kicker,
  position,
  width = 320,
  children,
  onPositionChange,
}: FloatingWindowProps) {
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, label")) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: position.offsetX,
      startY: position.offsetY,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || moveEvent.pointerId !== dragState.pointerId) {
        return;
      }

      onPositionChange({
        horizontal: position.horizontal,
        vertical: position.vertical,
        offsetX: Math.max(
          12,
          dragState.startX +
            (position.horizontal === "left"
              ? moveEvent.clientX - dragState.startClientX
              : dragState.startClientX - moveEvent.clientX),
        ),
        offsetY: Math.max(
          12,
          dragState.startY +
            (position.vertical === "top"
              ? moveEvent.clientY - dragState.startClientY
              : dragState.startClientY - moveEvent.clientY),
        ),
      });
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || upEvent.pointerId !== dragState.pointerId) {
        return;
      }

      dragStateRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <section
      className="floating-window"
      style={{
        width: `${width}px`,
        [position.horizontal]: `${position.offsetX}px`,
        [position.vertical]: `${position.offsetY}px`,
      }}
    >
      <header className="floating-window-header" onPointerDown={handlePointerDown}>
        <div>
          {kicker ? <p className="section-kicker">{kicker}</p> : null}
          <h2>{title}</h2>
        </div>
        <span className="floating-window-drag-hint">drag</span>
      </header>
      <div className="floating-window-body">{children}</div>
    </section>
  );
}
