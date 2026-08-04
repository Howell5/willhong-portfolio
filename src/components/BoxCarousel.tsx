"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type ValueAnimationOptions,
} from "framer-motion";

import { cn } from "../lib/utils";

export interface CarouselItem {
  id: string;
  type: "image" | "video";
  src: string;
  alt?: string;
  poster?: string;
  url?: string;
  title?: string;
}

interface FaceProps {
  transform: string;
  className?: string;
  children?: ReactNode;
  style?: React.CSSProperties;
  debug?: boolean;
}

const CubeFace = memo(
  ({ transform, className, children, style, debug }: FaceProps) => (
    <div
      className={cn(
        "absolute overflow-hidden",
        debug && "backface-visible opacity-50",
        className
      )}
      style={{ transform, ...style }}
    >
      {children}
    </div>
  )
);

CubeFace.displayName = "CubeFace";

const MediaRenderer = memo(
  ({
    item,
    className,
    debug = false,
  }: {
    item: CarouselItem;
    className?: string;
    debug?: boolean;
  }) => {
    if (!debug) {
      if (item.type === "video") {
        return (
          <video
            src={item.src}
            poster={item.poster}
            className={cn("w-full h-full object-cover", className)}
            muted
            loop
            autoPlay
            playsInline
          />
        );
      }

      return (
        <img
          src={item.src}
          alt={item.alt || ""}
          draggable={false}
          className={cn("w-full h-full object-cover", className)}
        />
      );
    }

    return (
      <div
        className={cn(
          "w-full h-full flex items-center justify-center border text-2xl",
          className
        )}
      >
        {item.id}
      </div>
    );
  }
);

MediaRenderer.displayName = "MediaRenderer";

export interface BoxCarouselRef {
  next: () => void;
  prev: () => void;
  getCurrentItemIndex: () => number;
}

type RotationDirection = "top" | "bottom" | "left" | "right";

interface SpringConfig {
  stiffness?: number;
  damping?: number;
  mass?: number;
}

// 每个 direction 下 4 个 face 的本地朝向角（deg），顺序与 faceTransforms 一致。
// 世界朝向 = 本地朝向 + 整体旋转角，世界朝向最接近 0°（正面 +Z）的 face 即当前正面。
const FACE_LOCAL_ANGLES: Record<RotationDirection, number[]> = {
  left: [-90, 0, 90, 180],
  right: [90, 0, -90, 180],
  top: [90, 0, -90, 180],
  bottom: [-90, 0, 90, 180],
};

function getFrontFaceIndex(
  direction: RotationDirection,
  rotation: number
): number {
  const locals = FACE_LOCAL_ANGLES[direction];
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < 4; i++) {
    let diff = Math.abs(((locals[i] + rotation) % 360 + 360) % 360);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

interface BoxCarouselProps extends React.HTMLProps<HTMLDivElement> {
  items: CarouselItem[];
  width: number;
  height: number;
  className?: string;
  debug?: boolean;
  perspective?: number;
  direction?: RotationDirection;
  transition?: ValueAnimationOptions<number>;
  snapTransition?: ValueAnimationOptions<number>;
  dragSpring?: SpringConfig;
  autoPlay?: boolean;
  autoPlayInterval?: number;
  onIndexChange?: (index: number) => void;
  enableDrag?: boolean;
  dragSensitivity?: number;
}

const BoxCarousel = forwardRef<BoxCarouselRef, BoxCarouselProps>(
  (
    {
      items,
      width,
      height,
      className,
      perspective = 600,
      debug = false,
      direction = "left",
      transition = { duration: 1.25, ease: [0.953, 0.001, 0.019, 0.995] },
      snapTransition = { type: "spring", damping: 30, stiffness: 200 },
      dragSpring = { stiffness: 200, damping: 30 },
      autoPlay = false,
      autoPlayInterval = 3000,
      onIndexChange,
      enableDrag = true,
      dragSensitivity = 0.5,
      ...props
    },
    ref
  ) => {
    const [currentItemIndex, setCurrentItemIndex] = useState(0);
    const [currentFrontFaceIndex, setCurrentFrontFaceIndex] = useState(1);

    const prefersReducedMotion = useReducedMotion();

    const _transition = prefersReducedMotion ? { duration: 0 } : transition;

    const [prevIndex, setPrevIndex] = useState(items.length - 1);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [nextIndex, setNextIndex] = useState(1);
    const [afterNextIndex, setAfterNextIndex] = useState(2);

    const [currentRotation, setCurrentRotation] = useState(0);

    const rotationCount = useRef(1);
    const isRotating = useRef(false);
    const pendingIndexChange = useRef<number | null>(null);
    const isDraggingRef = useRef(false);
    const [isDragging, setIsDragging] = useState(false);
    const startPosition = useRef({ x: 0, y: 0 });
    const startRotation = useRef(0);

    const baseRotateX = useMotionValue(0);
    const baseRotateY = useMotionValue(0);

    const springRotateX = useSpring(baseRotateX, dragSpring);
    const springRotateY = useSpring(baseRotateY, dragSpring);

    const handleAnimationComplete = useCallback(
      (triggeredBy: string) => {
        if (isRotating.current && pendingIndexChange.current !== null) {
          isRotating.current = false;

          let newFrontFaceIndex: number;
          let currentBackFaceIndex: number;

          if (triggeredBy === "next") {
            newFrontFaceIndex = (currentFrontFaceIndex + 1) % 4;
            currentBackFaceIndex = (newFrontFaceIndex + 2) % 4;
          } else {
            newFrontFaceIndex = (currentFrontFaceIndex - 1 + 4) % 4;
            currentBackFaceIndex = (newFrontFaceIndex + 3) % 4;
          }

          setCurrentItemIndex(pendingIndexChange.current);
          onIndexChange?.(pendingIndexChange.current);

          const indexOffset = triggeredBy === "next" ? 2 : -1;

          if (currentBackFaceIndex === 0) {
            setPrevIndex(
              (pendingIndexChange.current + indexOffset + items.length) %
                items.length
            );
          } else if (currentBackFaceIndex === 1) {
            setCurrentIndex(
              (pendingIndexChange.current + indexOffset + items.length) %
                items.length
            );
          } else if (currentBackFaceIndex === 2) {
            setNextIndex(
              (pendingIndexChange.current + indexOffset + items.length) %
                items.length
            );
          } else if (currentBackFaceIndex === 3) {
            setAfterNextIndex(
              (pendingIndexChange.current + indexOffset + items.length) %
                items.length
            );
          }

          pendingIndexChange.current = null;
          rotationCount.current++;

          setCurrentFrontFaceIndex(newFrontFaceIndex);
        }
      },
      [currentFrontFaceIndex, items.length, onIndexChange]
    );

    const handleDragStart = useCallback(
      (e: React.MouseEvent | React.TouchEvent) => {
        if (!enableDrag || isRotating.current) return;

        isDraggingRef.current = true;
        setIsDragging(true);
        const point = "touches" in e ? e.touches[0] : e;
        startPosition.current = { x: point.clientX, y: point.clientY };
        startRotation.current = currentRotation;

        e.preventDefault();
      },
      [enableDrag, currentRotation]
    );

    const handleDragMove = useCallback(
      (e: MouseEvent | TouchEvent) => {
        if (!isDraggingRef.current || isRotating.current) return;

        const point = "touches" in e ? e.touches[0] : e;
        const deltaX = point.clientX - startPosition.current.x;
        const deltaY = point.clientY - startPosition.current.y;

        const isVertical = direction === "top" || direction === "bottom";
        const delta = isVertical ? deltaY : deltaX;
        const rotationDelta = (delta * dragSensitivity) / 2;

        let newRotation = startRotation.current;

        if (direction === "top" || direction === "left") {
          newRotation += rotationDelta;
        } else {
          newRotation -= rotationDelta;
        }

        const minRotation = startRotation.current - 120;
        const maxRotation = startRotation.current + 120;
        newRotation = Math.max(minRotation, Math.min(maxRotation, newRotation));

        if (isVertical) {
          baseRotateX.set(newRotation);
        } else {
          baseRotateY.set(newRotation);
        }
      },
      [direction, dragSensitivity, baseRotateX, baseRotateY]
    );

    const handleDragEnd = useCallback(() => {
      if (!isDraggingRef.current) return;

      isDraggingRef.current = false;
      setIsDragging(false);

      const isVertical = direction === "top" || direction === "bottom";
      const currentValue = isVertical ? baseRotateX.get() : baseRotateY.get();

      const snappedRotation = Math.round(currentValue / 90) * 90;

      // 几何判定：snap 后哪个 face 转到正面。用 face 序号关系（而非拖拽方向/旋转符号）
      // 决定 next/prev，从任意角度、任意方向拖拽都自洽。
      const targetFrontFace = getFrontFaceIndex(direction, snappedRotation);
      const currentFrontFace = currentFrontFaceIndex;

      if (targetFrontFace === currentFrontFace) {
        // 未跨过 90° 边界，回弹到起始角度
        const targetMotionValue = isVertical ? baseRotateX : baseRotateY;
        animate(targetMotionValue, currentRotation, snapTransition);
        return;
      }

      isRotating.current = true;

      const triggeredBy: "next" | "prev" =
        targetFrontFace === (currentFrontFace + 1) % 4 ? "next" : "prev";

      const newItemIndex =
        triggeredBy === "next"
          ? (currentItemIndex + 1) % items.length
          : currentItemIndex === 0
            ? items.length - 1
            : currentItemIndex - 1;

      pendingIndexChange.current = newItemIndex;

      const targetMotionValue = isVertical ? baseRotateX : baseRotateY;
      animate(targetMotionValue, snappedRotation, {
        ...snapTransition,
        onComplete: () => {
          handleAnimationComplete(triggeredBy);
          setCurrentRotation(snappedRotation);
        },
      });
    }, [
      direction,
      baseRotateX,
      baseRotateY,
      currentRotation,
      currentItemIndex,
      currentFrontFaceIndex,
      items.length,
      snapTransition,
      handleAnimationComplete,
    ]);

    useEffect(() => {
      if (enableDrag) {
        window.addEventListener("mousemove", handleDragMove);
        window.addEventListener("mouseup", handleDragEnd);
        window.addEventListener("touchmove", handleDragMove);
        window.addEventListener("touchend", handleDragEnd);

        return () => {
          window.removeEventListener("mousemove", handleDragMove);
          window.removeEventListener("mouseup", handleDragEnd);
          window.removeEventListener("touchmove", handleDragMove);
          window.removeEventListener("touchend", handleDragEnd);
        };
      }
    }, [enableDrag, handleDragMove, handleDragEnd]);

    const next = useCallback(() => {
      if (items.length === 0 || isRotating.current) return;

      isRotating.current = true;
      const newIndex = (currentItemIndex + 1) % items.length;
      pendingIndexChange.current = newIndex;

      if (direction === "top") {
        animate(baseRotateX, currentRotation + 90, {
          ..._transition,
          onComplete: () => {
            handleAnimationComplete("next");
            setCurrentRotation(currentRotation + 90);
          },
        });
      } else if (direction === "bottom") {
        animate(baseRotateX, currentRotation - 90, {
          ..._transition,
          onComplete: () => {
            handleAnimationComplete("next");
            setCurrentRotation(currentRotation - 90);
          },
        });
      } else if (direction === "left") {
        animate(baseRotateY, currentRotation - 90, {
          ..._transition,
          onComplete: () => {
            handleAnimationComplete("next");
            setCurrentRotation(currentRotation - 90);
          },
        });
      } else if (direction === "right") {
        animate(baseRotateY, currentRotation + 90, {
          ..._transition,
          onComplete: () => {
            handleAnimationComplete("next");
            setCurrentRotation(currentRotation + 90);
          },
        });
      }
    }, [
      items.length,
      currentItemIndex,
      direction,
      _transition,
      currentRotation,
      baseRotateX,
      baseRotateY,
      handleAnimationComplete,
    ]);

    const prev = useCallback(() => {
      if (items.length === 0 || isRotating.current) return;

      isRotating.current = true;
      const newIndex =
        currentItemIndex === 0 ? items.length - 1 : currentItemIndex - 1;
      pendingIndexChange.current = newIndex;

      if (direction === "top") {
        animate(baseRotateX, currentRotation - 90, {
          ..._transition,
          onComplete: () => {
            handleAnimationComplete("prev");
            setCurrentRotation(currentRotation - 90);
          },
        });
      } else if (direction === "bottom") {
        animate(baseRotateX, currentRotation + 90, {
          ..._transition,
          onComplete: () => {
            handleAnimationComplete("prev");
            setCurrentRotation(currentRotation + 90);
          },
        });
      } else if (direction === "left") {
        animate(baseRotateY, currentRotation + 90, {
          ..._transition,
          onComplete: () => {
            handleAnimationComplete("prev");
            setCurrentRotation(currentRotation + 90);
          },
        });
      } else if (direction === "right") {
        animate(baseRotateY, currentRotation - 90, {
          ..._transition,
          onComplete: () => {
            handleAnimationComplete("prev");
            setCurrentRotation(currentRotation - 90);
          },
        });
      }
    }, [
      items.length,
      currentItemIndex,
      direction,
      _transition,
      currentRotation,
      baseRotateX,
      baseRotateY,
      handleAnimationComplete,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        next,
        prev,
        getCurrentItemIndex: () => currentItemIndex,
      }),
      [next, prev, currentItemIndex]
    );

    const depth = useMemo(
      () => (direction === "top" || direction === "bottom" ? height : width),
      [direction, width, height]
    );

    const transform = useTransform(
      isDragging
        ? [springRotateX, springRotateY]
        : [baseRotateX, baseRotateY],
      ([x, y]) =>
        `translateZ(-${depth / 2}px) rotateX(${x}deg) rotateY(${y}deg)`
    );

    const faceTransforms = (() => {
      switch (direction) {
        case "left":
          return [
            `rotateY(-90deg) translateZ(${width / 2}px)`,
            `rotateY(0deg) translateZ(${depth / 2}px)`,
            `rotateY(90deg) translateZ(${width / 2}px)`,
            `rotateY(180deg) translateZ(${depth / 2}px)`,
          ];
        case "top":
          return [
            `rotateX(90deg) translateZ(${height / 2}px)`,
            `rotateY(0deg) translateZ(${depth / 2}px)`,
            `rotateX(-90deg) translateZ(${height / 2}px)`,
            `rotateY(180deg) translateZ(${depth / 2}px) rotateZ(180deg)`,
          ];
        case "right":
          return [
            `rotateY(90deg) translateZ(${width / 2}px)`,
            `rotateY(0deg) translateZ(${depth / 2}px)`,
            `rotateY(-90deg) translateZ(${width / 2}px)`,
            `rotateY(180deg) translateZ(${depth / 2}px)`,
          ];
        case "bottom":
          return [
            `rotateX(-90deg) translateZ(${height / 2}px)`,
            `rotateY(0deg) translateZ(${depth / 2}px)`,
            `rotateX(90deg) translateZ(${height / 2}px)`,
            `rotateY(180deg) translateZ(${depth / 2}px) rotateZ(180deg)`,
          ];
        default:
          return [
            `rotateY(-90deg) translateZ(${width / 2}px)`,
            `rotateY(0deg) translateZ(${depth / 2}px)`,
            `rotateY(90deg) translateZ(${width / 2}px)`,
            `rotateY(180deg) translateZ(${depth / 2}px)`,
          ];
      }
    })();

    useEffect(() => {
      if (autoPlay && items.length > 0) {
        const interval = setInterval(next, autoPlayInterval);
        return () => clearInterval(interval);
      }
    }, [autoPlay, items.length, next, autoPlayInterval]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (isRotating.current) return;

        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            if (direction === "left" || direction === "right") {
              prev();
            }
            break;
          case "ArrowRight":
            e.preventDefault();
            if (direction === "left" || direction === "right") {
              next();
            }
            break;
          case "ArrowUp":
            e.preventDefault();
            if (direction === "top" || direction === "bottom") {
              prev();
            }
            break;
          case "ArrowDown":
            e.preventDefault();
            if (direction === "top" || direction === "bottom") {
              next();
            }
            break;
          default:
            break;
        }
      },
      [direction, next, prev]
    );

    return (
      <div
        className={cn(
          "relative focus:outline-0",
          enableDrag && "cursor-move",
          className
        )}
        style={{
          width,
          height,
          perspective: `${perspective}px`,
        }}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-label={`3D carousel with ${items.length} items`}
        aria-describedby="carousel-instructions"
        aria-live="polite"
        aria-atomic="true"
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        {...props}
      >
        <div className="sr-only" aria-live="assertive">
          Showing item {currentItemIndex + 1} of {items.length}:{" "}
          {items[currentItemIndex]?.alt || `Item ${currentItemIndex + 1}`}
        </div>

        <motion.div
          className="relative w-full h-full [transform-style:preserve-3d]"
          style={{
            transform: transform,
          }}
        >
          <CubeFace
            transform={faceTransforms[0]}
            style={
              debug
                ? { width, height, backgroundColor: "#ff9999" }
                : { width, height }
            }
            debug={debug}
          >
            <MediaRenderer item={items[prevIndex]} debug={debug} />
          </CubeFace>

          <CubeFace
            transform={faceTransforms[1]}
            style={
              debug
                ? { width, height, backgroundColor: "#99ff99" }
                : { width, height }
            }
            debug={debug}
          >
            <MediaRenderer item={items[currentIndex]} debug={debug} />
          </CubeFace>

          <CubeFace
            transform={faceTransforms[2]}
            style={
              debug
                ? { width, height, backgroundColor: "#9999ff" }
                : { width, height }
            }
            debug={debug}
          >
            <MediaRenderer item={items[nextIndex]} debug={debug} />
          </CubeFace>

          <CubeFace
            transform={faceTransforms[3]}
            style={
              debug
                ? { width, height, backgroundColor: "#ffff99" }
                : { width, height }
            }
            debug={debug}
          >
            <MediaRenderer item={items[afterNextIndex]} debug={debug} />
          </CubeFace>
        </motion.div>
      </div>
    );
  }
);

BoxCarousel.displayName = "BoxCarousel";

export default BoxCarousel;
export type { RotationDirection, SpringConfig };
