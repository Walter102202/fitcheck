import type { Category } from '@fitcheck/contracts';
import { useState } from 'react';
import { photosEnabled } from '../lib/photos.js';
import { ICON_PROPS, Tv, Wind } from './icons.js';
import styles from './ProductImage.module.css';

/** The listing photo, or the category icon when photos are off, missing or broken. */
export function ProductImage({
  src,
  category,
  size,
  alt,
}: {
  src: string | null;
  category: Category;
  size: 56 | 72 | 112;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  if (src && !failed && photosEnabled()) {
    return (
      <img
        className={styles.frame}
        data-size={size}
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  const Icon = category === 'tv' ? Tv : Wind;
  return (
    <span
      className={styles.frame}
      data-size={size}
      data-photo="none"
      role="img"
      aria-label={category === 'tv' ? 'TV' : 'Hair dryer'}
    >
      <Icon {...ICON_PROPS} size={size >= 112 ? 32 : 24} />
    </span>
  );
}
