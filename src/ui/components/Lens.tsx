import type { JSX } from "react";
import { motion } from "framer-motion";
import { LAYOUT_SPRING } from "../motion";
import styles from "./Lens.module.css";

export function Lens({ group, value, radius, className }: { group: string; value: string; radius: number; className?: string }): JSX.Element {
  return (
    <motion.span
      layoutId={group}
      layoutDependency={value}
      aria-hidden="true"
      className={className ? `${styles.lens} ${className}` : styles.lens}
      style={{ borderRadius: radius }}
      transition={LAYOUT_SPRING}
    />
  );
}
