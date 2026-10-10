/** @jsxImportSource ../runtime */
import { Qr, VStack, type TextChildren } from "../runtime/jsx-runtime";
import type { Element } from "../runtime/types";
import type { IconComponent } from "../icons/factory";
import { MateCrewMark } from "./brand";
import { Surface } from "./surface";
import { Muted } from "./typography";

/**
 * A QR code to scan from a phone at arm's length: rounded modules and finder patterns, the
 * mark in a cleared centre (high error correction), on a card. The children are its caption.
 *
 *   <QrCode value={url} size={280}>Scanne pour valider</QrCode>
 */
export function QrCode({
  value,
  size = 288,
  logo = MateCrewMark,
  style = "rounded",
  children,
}: {
  value: unknown;
  size?: number;
  /** `null` for a plain code (more room for long payloads). */
  logo?: IconComponent | null;
  style?: "square" | "dots" | "rounded";
  children?: TextChildren;
}): Element {
  const logoSize = Math.round(size / 7 / 4) * 4;
  return (
    <VStack gap={12} align="center">
      <Surface variant="outline" radius={16} width={size} height={size} padding={6}>
        <Qr
          width="fill"
          height="fill"
          value={value}
          style={style}
          ecc="quartile"
          quiet={2}
          {...(logo ? { logo: (props) => logo({ ...props, size: logoSize }) } : {})}
        />
      </Surface>
      {children !== undefined && <Muted align="center" width={size}>{children}</Muted>}
    </VStack>
  );
}
