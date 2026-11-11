import { type AgentPick, type Category, formatUsd } from '@fitcheck/contracts';
import styles from './ProductCard.module.css';
import { ProductImage } from './ProductImage.js';

/** What the agent picked: photo, title, store, its words and the price. */
export function ProductCard({ pick, category }: { pick: AgentPick; category: Category }) {
  return (
    <div className={styles.pick}>
      <ProductImage
        src={pick.image}
        category={category}
        size={112}
        alt="Product photo from the listing"
      />
      <div>
        <h3>{pick.title}</h3>
        <div className="note">{pick.domain}</div>
        <div className="note">The agent says: “{pick.agentSays}”</div>
      </div>
      <div className={styles.price}>{formatUsd(pick.priceCents)}</div>
    </div>
  );
}
