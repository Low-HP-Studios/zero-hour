import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-left"
      theme="dark"
      richColors
      closeButton
      visibleToasts={4}
      expand
      offset={24}
      toastOptions={{
        classNames: {
          toast: "app-toast",
          title: "app-toast-title",
          description: "app-toast-description",
          closeButton: "app-toast-close",
          actionButton: "app-toast-action",
          cancelButton: "app-toast-cancel",
          success: "app-toast-success",
          info: "app-toast-info",
          warning: "app-toast-warning",
          error: "app-toast-error",
        },
      }}
      {...props}
    />
  );
}
