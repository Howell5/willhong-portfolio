"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BoxCarousel, {
  type CarouselItem,
  type BoxCarouselRef,
} from "./BoxCarousel";

const works: CarouselItem[] = [
  {
    id: "avatar",
    type: "image",
    src: "/works/avatar.jpg",
    alt: "Will Hong",
    title: "Will Hong",
  },
  {
    id: "genapp",
    type: "image",
    src: "/works/genapp.png",
    alt: "GenApp.now - Turn AI-generated code into real business in 60 seconds",
    title: "GenApp.now",
    url: "https://genapp.now",
  },
  {
    id: "pale-blue-dot",
    type: "image",
    src: "/works/pale-blue-dot.png",
    alt: "Pale Blue Dot",
    title: "Pale Blue Dot",
  },
  {
    id: "blog",
    type: "image",
    src: "/works/blog.svg",
    alt: "Blog",
    title: "Blog",
    url: "/blogs",
  },
];

interface WorksCarouselProps {
  onIndexChange?: (index: number) => void;
}

export default function WorksCarousel({ onIndexChange }: WorksCarouselProps) {
  // 初始为 null：首帧不渲染 cube，等量完视口后直接以最终尺寸出现，
  // 避免固定 320×320 → 真实尺寸的“由小变大”闪烁。
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const carouselRef = useRef<BoxCarouselRef>(null);
  const clickStartTime = useRef<number>(0);
  const clickStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const updateDimensions = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const maxWidth = Math.min(vw * 0.85, 480);
      const maxHeight = Math.min(vh * 0.5, 480);
      const size = Math.min(maxWidth, maxHeight);

      setDimensions({
        width: size,
        height: size,
      });
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  const handleIndexChange = useCallback(
    (index: number) => {
      setCurrentIndex(index);
      onIndexChange?.(index);
    },
    [onIndexChange]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    clickStartTime.current = Date.now();
    clickStartPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const elapsed = Date.now() - clickStartTime.current;
      const dx = Math.abs(e.clientX - clickStartPos.current.x);
      const dy = Math.abs(e.clientY - clickStartPos.current.y);

      // Only treat as click if it was quick and didn't move much (not a drag)
      if (elapsed < 200 && dx < 10 && dy < 10) {
        const currentWork = works[currentIndex];
        if (currentWork?.url) {
          if (currentWork.url.startsWith("/")) {
            window.location.href = currentWork.url;
          } else {
            window.open(currentWork.url, "_blank", "noopener,noreferrer");
          }
        }
      }
    },
    [currentIndex]
  );

  const currentWork = works[currentIndex];

  if (!dimensions) {
    // 首帧占位：尺寸与最终 cube 完全一致（min(85vw, 480px) 与 min(50vh, 480px)
    // 取小，正方形），等价于 JS 的 size = Math.min(vw*0.85, 480, vh*0.5, 480)，
    // cube 在尺寸就绪后直接出现，无任何缩放/跳动。
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="aspect-square w-[min(min(85vw,480px),min(50vh,480px))] max-w-full" />
        {currentWork?.title && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {currentWork.title}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        className={currentWork?.url ? "cursor-pointer" : undefined}
      >
        <BoxCarousel
          ref={carouselRef}
          items={works}
          width={dimensions.width}
          height={dimensions.height}
          direction="left"
          perspective={800}
          autoPlay
          autoPlayInterval={4000}
          onIndexChange={handleIndexChange}
        />
      </div>
      {currentWork?.title && (
        <div className="text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {currentWork.url ? (
              <a
                href={currentWork.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                {currentWork.title} ↗
              </a>
            ) : (
              currentWork.title
            )}
          </p>
        </div>
      )}
    </div>
  );
}

export { works };
