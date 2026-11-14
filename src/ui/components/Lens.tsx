import type { JSX } from "react";
import { motion } from "framer-motion";
import { DURATION_MS, EASE, seconds } from "../motion";
import styles from "./Lens.module.css";

const SLIDE = { duration: seconds(DURATION_MS.base), ease: [...EASE.out] as [number, number, number, number] };

export function Lens({ group, value, radius, className }: { group: string; value: string; radius: number; className?: string }): JSX.Element {
  return (
    <motion.span
      layoutId={group}
      layoutDependency={value}
      aria-hidden="true"
      className={className ? `${styles.lens} ${className}` : styles.lens}
      style={{ borderRadius: radius }}
      transition={SLIDE}
    />
  );
}
