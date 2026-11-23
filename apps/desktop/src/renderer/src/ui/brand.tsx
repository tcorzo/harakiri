import type { ReactNode } from "react";

/*
 * harakiri's crane, drawn from the app icon (docs/assets/readme/icon.svg) without its tile, so it
 * sits on any backdrop: the crane takes the text colour and its dot takes Harakiri Red.
 */

const red = "var(--color-band)";

const cranePaper = [
  "M292.7 404.0C328.8 401.4 364.2 394.4 399.7 387.5C418.8 383.9 437.9 380.5 456.7 375.8C473.7 371.5 504.9 362.3 500.9 339.0C498.3 323.3 479.3 316.9 465.3 318.4C458.6 319.1 452.3 321.5 446.1 324.0C426.9 331.7 408.8 342.1 390.1 350.9C356.6 366.7 322.9 382.3 292.7 404.0Z",
  "M548.8 353.6C561.0 351.2 573.8 347.3 586.4 348.8C595.1 349.8 619.8 359.3 626.9 364.4C639.8 373.8 655.0 401.3 656.0 417.2C656.7 429.2 653.9 441.0 650.6 452.5C647.1 464.6 643.3 476.8 638.2 488.4C624.2 519.4 604.5 547.5 595.5 580.7C570.8 671.7 598.8 763.3 658.3 834.4C678.8 859.1 705.2 879.0 729.7 899.5C715.7 876.8 699.9 855.2 686.4 832.2C660.5 787.9 640.9 730.1 641.1 678.5C641.2 646.5 644.6 612.3 655.7 582.1C663.5 560.8 675.0 541.0 684.3 520.4C697.8 490.2 716.3 427.7 716.0 395.0C715.7 360.3 695.5 315.9 657.7 309.3C641.5 306.5 623.9 312.1 609.4 318.7C588.1 328.6 568.9 341.8 548.8 353.6Z",
] as const;

const craneDot =
  "M508.5 271.3C497.1 289.8 510.0 304.3 529.6 305.0C534.9 305.3 540.2 304.5 545.3 302.8C555.8 299.4 579.2 286.4 585.4 277.2C596.2 260.9 581.9 244.2 564.9 242.9C543.6 241.4 519.7 253.1 508.5 271.3Z";

/** The app icon's crane, without its tile. Two units wide for every three tall. */
export const CraneMark = ({
  className,
  label,
}: {
  readonly className?: string;
  readonly label?: string;
}): ReactNode => (
  <svg
    viewBox="290 238 443 664"
    className={className}
    fill="currentColor"
    {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
  >
    {cranePaper.map((d) => (
      <path key={d.slice(0, 16)} d={d} />
    ))}
    <path d={craneDot} fill={red} />
  </svg>
);
