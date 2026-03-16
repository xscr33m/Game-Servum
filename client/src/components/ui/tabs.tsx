"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [hasAnimated, setHasAnimated] = React.useState(false);
  const [indicator, setIndicator] = React.useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const mergedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const updateIndicator = React.useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>('[data-state="active"]');
    if (!active) {
      setIndicator(null);
      return;
    }
    setIndicator({
      left: active.offsetLeft,
      top: active.offsetTop,
      width: active.offsetWidth,
      height: active.offsetHeight,
    });
  }, []);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    updateIndicator();

    const mo = new MutationObserver(() => {
      setHasAnimated(true);
      updateIndicator();
    });
    mo.observe(list, {
      attributes: true,
      attributeFilter: ["data-state"],
      subtree: true,
    });

    const ro = new ResizeObserver(() => updateIndicator());
    ro.observe(list);

    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, [updateIndicator]);

  return (
    <TabsPrimitive.List
      ref={mergedRef}
      className={cn(
        "relative inline-flex h-11 items-center justify-center rounded-xl bg-muted p-1.5 text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {indicator && (
        <div
          className={cn(
            "absolute left-0 top-0 rounded-lg bg-background shadow-sm pointer-events-none",
            hasAnimated
              ? "transition-all duration-300 ease-out"
              : "transition-none",
          )}
          style={{
            transform: `translate(${indicator.left}px, ${indicator.top}px)`,
            width: `${indicator.width}px`,
            height: `${indicator.height}px`,
          }}
        />
      )}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative z-10 inline-flex items-center justify-center whitespace-nowrap hover:cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=inactive]:hover:text-foreground/80 data-[state=inactive]:hover:bg-muted-foreground/10 data-[state=active]:text-foreground",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
