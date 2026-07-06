import { useEffect, useMemo, useRef, useState } from "react";
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
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  }));
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const resolvedLayout = useMemo(() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return {
        width,
        offsetX: position.offsetX,
        offsetY: position.offsetY,
        maxHeight: undefined as number | undefined,
      };
    }

    const viewportPadding = 12;
    const minWidth = Math.min(220, Math.max(0, viewportSize.width - viewportPadding * 2));
    const resolvedWidth = Math.max(
      minWidth,
      Math.min(width, viewportSize.width - viewportPadding * 2),
    );
    const maxOffsetX = Math.max(viewportPadding, viewportSize.width - resolvedWidth - viewportPadding);
    const minHeight = Math.min(180, Math.max(0, viewportSize.height - viewportPadding * 2));
    const maxOffsetY = Math.max(viewportPadding, viewportSize.height - minHeight - viewportPadding);
    const resolvedOffsetX = Math.min(Math.max(position.offsetX, viewportPadding), maxOffsetX);
    const resolvedOffsetY = Math.min(Math.max(position.offsetY, viewportPadding), maxOffsetY);

    return {
      width: resolvedWidth,
      offsetX: resolvedOffsetX,
      offsetY: resolvedOffsetY,
      maxHeight: Math.max(minHeight, viewportSize.height - resolvedOffsetY - viewportPadding),
    };
  }, [position.offsetX, position.offsetY, viewportSize.height, viewportSize.width, width]);

  useEffect(() => {
    function handleResize() {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

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
        width: `${resolvedLayout.width}px`,
        maxHeight: resolvedLayout.maxHeight ? `${resolvedLayout.maxHeight}px` : undefined,
        [position.horizontal]: `${resolvedLayout.offsetX}px`,
        [position.vertical]: `${resolvedLayout.offsetY}px`,
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
