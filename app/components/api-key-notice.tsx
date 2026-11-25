import { Icon } from "./ui-icon";
import styles from "./api-key-notice.module.css";

export function ApiKeyNotice({ onSetKey }: { onSetKey: () => void }) {
  return <div className={styles.notice} role="status">
    <Icon name="info" size={20} />
    <div className={styles.copy}>
      <strong>Deepgram API key required</strong>
      <p>Add your API key to record audio, generate speech, or start a live conversation.</p>
    </div>
    <button type="button" className={`button button-outline ${styles.action}`} onClick={onSetKey}><Icon name="settings" size={16} />Set API key</button>
  </div>;
}
