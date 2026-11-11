import styles from "./brand-mark.module.css";

export function BrandMark() {
  return (
    <span className={styles.brand}>
      <span className={styles.mark} aria-hidden="true">
        N
      </span>
      <span className={styles.name}>NEXUS AI</span>
    </span>
  );
}
