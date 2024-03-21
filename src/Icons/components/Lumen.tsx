import * as React from "react"
import SvgIcon from "@material-ui/core/SvgIcon"

interface Props {
  className?: string
  onClick?: () => void
  style?: React.CSSProperties
}

function LumenIcon(props: Props) {
  return (
    <SvgIcon viewBox="0 0 236.36 200" {...props}>
      <path d="M203 26.16l-28.46 14.5-137.43 70a82.49 82.49 0 01-.7-10.69A81.87 81.87 0 01158.2 28.6l16.29-8.3 2.43-1.24A100 100 0 0018.18 100q0 3.82.29 7.61a18.19 18.19 0 01-9.88 17.58L0 129.57V150l25.29-12.89 8.19-4.18 8.07-4.11L186.43 55l16.28-8.29 33.65-17.15V9.14zM236.36 50L49.78 145l-16.28 8.31L0 170.38v20.41l33.27-16.95 28.46-14.5 137.57-70.1A83.45 83.45 0 01200 100a81.87 81.87 0 01-121.91 71.36l-1 .53-17.66 9A100 100 0 00218.18 100c0-2.57-.1-5.14-.29-7.68a18.2 18.2 0 019.87-17.58l8.6-4.38z" />
    </SvgIcon>
  )
}

export default LumenIcon
