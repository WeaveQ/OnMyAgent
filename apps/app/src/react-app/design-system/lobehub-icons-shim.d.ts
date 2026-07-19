/**
 * Deep imports into `@lobehub/icons/es/<Brand>` avoid the package root barrel
 * (which re-exports features that peer-depend on `@lobehub/ui` / antd).
 * The package does not publish subpath types, so we declare a minimal shape.
 */
declare module "@lobehub/icons/es/*" {
  import type { CSSProperties, FC } from "react";

  export type LobeBrandIconProps = {
    size?: number | string;
    className?: string;
    style?: CSSProperties;
    color?: string;
  };

  type LobeBrandIcon = FC<LobeBrandIconProps> & {
    Color?: FC<LobeBrandIconProps>;
    Avatar?: FC<LobeBrandIconProps>;
    Brand?: FC<LobeBrandIconProps>;
    BrandColor?: FC<LobeBrandIconProps>;
    Text?: FC<LobeBrandIconProps>;
    Combine?: FC<LobeBrandIconProps>;
  };

  const Icon: LobeBrandIcon;
  export default Icon;
}
