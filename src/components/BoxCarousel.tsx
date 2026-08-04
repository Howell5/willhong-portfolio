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

// 松手角速度达到该值（deg/ms = 150°/s）时，惯性甩动额外翻 1 格。
const FLING_STEP_VELOCITY = 0.15;

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
  /** 翻转动画开始时触发，参数为即将显示的面（用于提前切换下方文字） */
  onFlipStart?: (index: number) => void;
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
      onFlipStart,
      enableDrag = true,
      dragSensitivity = 1,
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
    const pendingSteps = useRef(0);
    const isDraggingRef = useRef(false);
    const [isDragging, setIsDragging] = useState(false);
    const startPosition = useRef({ x: 0, y: 0 });
    const startRotation = useRef(0);
    // 拖拽角速度（deg/ms，滑动平均）与最近一次移动记录，用于惯性甩动
    const velocityRef = useRef(0);
    const lastMoveRef = useRef({ time: 0, pos: 0 });

    const baseRotateX = useMotionValue(0);
    const baseRotateY = useMotionValue(0);

    const springRotateX = useSpring(baseRotateX, dragSpring);
    const springRotateY = useSpring(baseRotateY, dragSpring);

    const handleAnimationComplete = useCallback(
      (triggeredBy: "next" | "prev") => {
        if (!isRotating.current || pendingSteps.current === 0) return;
        isRotating.current = false;

        // 多格翻转：逐格推进 front/item，并更新每格“转出视野”的槽位
        const steps = pendingSteps.current;
        const len = items.length;
        const dir = triggeredBy === "next" ? 1 : -1;
        let front = currentFrontFaceIndex;
        let item = currentItemIndex;

        for (let k = 0; k < steps; k++) {
          const newFront = (front + dir + 4) % 4;
          const backFace =
            triggeredBy === "next" ? (newFront + 2) % 4 : (newFront + 3) % 4;
          const newItem = (item + dir + len) % len;
          const offset = triggeredBy === "next" ? 2 : -1;
          const backValue = (newItem + offset + len) % len;

          if (backFace === 0) {
            setPrevIndex(backValue);
          } else if (backFace === 1) {
            setCurrentIndex(backValue);
          } else if (backFace === 2) {
            setNextIndex(backValue);
          } else if (backFace === 3) {
            setAfterNextIndex(backValue);
          }

          front = newFront;
          item = newItem;
        }

        setCurrentItemIndex(item);
        onIndexChange?.(item);
        pendingSteps.current = 0;
        rotationCount.current += steps;
        setCurrentFrontFaceIndex(front);
      },
      [currentFrontFaceIndex, currentItemIndex, items.length, onIndexChange]
    );

    const handleDragStart = useCallback(
      (e: React.MouseEvent | React.TouchEvent) => {
        if (!enableDrag || isRotating.current) return;

        isDraggingRef.current = true;
        setIsDragging(true);
        const point = "touches" in e ? e.touches[0] : e;
        startPosition.current = { x: point.clientX, y: point.clientY };
        startRotation.current = currentRotation;
        velocityRef.current = 0;
        lastMoveRef.current = { time: 0, pos: 0 };

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
        const size = isVertical ? height : width;

        // 表面映射跟手：拖过一个面宽 = 旋转 90°（像真的拨动立方体表面）
        const rotationDelta = (delta / size) * 90 * dragSensitivity;

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

        // 记录角速度（deg/ms，滑动平均），供松手时惯性甩动
        const now = performance.now();
        const pos = isVertical ? point.clientY : point.clientX;
        const prev = lastMoveRef.current;
        if (prev.time > 0 && now > prev.time) {
          const instant =
            ((pos - prev.pos) / (now - prev.time)) *
            (90 / size) *
            dragSensitivity;
          velocityRef.current = velocityRef.current * 0.6 + instant * 0.4;
        }
        lastMoveRef.current = { time: now, pos };
      },
      [direction, dragSensitivity, baseRotateX, baseRotateY, width, height]
    );

    const handleDragEnd = useCallback(() => {
      if (!isDraggingRef.current) return;

      isDraggingRef.current = false;
      setIsDragging(false);

      const isVertical = direction === "top" || direction === "bottom";
      const currentValue = isVertical ? baseRotateX.get() : baseRotateY.get();

      const snappedRotation = Math.round(currentValue / 90) * 90;

      // 惯性甩动：松手角速度超过阈值时，额外翻 1-2 格（方向与甩动一致）
      const flingSteps = Math.max(
        -2,
        Math.min(2, Math.round(velocityRef.current / FLING_STEP_VELOCITY))
      );
      const targetRotation = snappedRotation + flingSteps * 90;

      // 几何判定：目标角度下哪个 face 转到正面（与方向/起始角度无关）
      const targetFrontFace = getFrontFaceIndex(direction, targetRotation);
      const currentFrontFace = currentFrontFaceIndex;

      if (targetFrontFace === currentFrontFace) {
        // 未跨过 90° 边界，回弹到起始角度
        const targetMotionValue = isVertical ? baseRotateX : baseRotateY;
        animate(targetMotionValue, currentRotation, snapTransition);
        return;
      }

      const rotationDiff = targetRotation - currentRotation;
      const movingNext =
        (direction === "left" || direction === "top")
          ? rotationDiff < 0
          : rotationDiff > 0;
      const steps = Math.max(
        1,
        Math.min(3, Math.round(Math.abs(rotationDiff) / 90))
      );

      isRotating.current = true;
      pendingSteps.current = steps;
      const targetItem =
        (currentItemIndex +
          (movingNext ? steps : -steps) +
          items.length) %
        items.length;
      onFlipStart?.(targetItem);

      const targetMotionValue = isVertical ? baseRotateX : baseRotateY;
      animate(targetMotionValue, targetRotation, {
        ...snapTransition,
        onComplete: () => {
          handleAnimationComplete(movingNext ? "next" : "prev");
          setCurrentRotation(targetRotation);
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
      onFlipStart,
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
      pendingSteps.current = 1;
      onFlipStart?.((currentItemIndex + 1) % items.length);

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
      onFlipStart,
    ]);

    const prev = useCallback(() => {
      if (items.length === 0 || isRotating.current) return;

      isRotating.current = true;
      pendingSteps.current = 1;
      onFlipStart?.(
        currentItemIndex === 0 ? items.length - 1 : currentItemIndex - 1
      );

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
      onFlipStart,
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
