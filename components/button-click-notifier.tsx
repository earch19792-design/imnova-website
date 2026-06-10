"use client"

import {
  useEffect,
} from "react"

import {
  toast,
} from "@/hooks/use-toast"

export function ButtonClickNotifier() {

  useEffect(
    () => {

      const handleClick =
        (event: MouseEvent) => {

          const target =
            event.target as HTMLElement | null

          const button =
            target?.closest(
              "[data-click-notify], [data-toast-message]"
            ) as HTMLButtonElement | HTMLElement | null

          if (
            !button ||
            button.closest("[toast-close]") ||
            button.getAttribute("aria-disabled") === "true" ||
            button.hasAttribute("disabled")
          ) {
            return
          }

          toast({
            title:
              button.getAttribute("data-toast-message") ||
              "Mensaje enviado",
          })

        }

      document.addEventListener(
        "click",
        handleClick,
        true
      )

      return () =>
        document.removeEventListener(
          "click",
          handleClick,
          true
        )

    },
    []
  )

  return null

}
