import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "group-[.toaster]:!bg-card group-[.toaster]:!text-foreground group-[.toaster]:!border-success/30",
          error:
            "group-[.toaster]:!bg-card group-[.toaster]:!text-foreground group-[.toaster]:!border-destructive/30",
          info: "group-[.toaster]:!bg-card group-[.toaster]:!text-foreground group-[.toaster]:!border-info/30",
          warning:
            "group-[.toaster]:!bg-card group-[.toaster]:!text-foreground group-[.toaster]:!border-warning/30",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
