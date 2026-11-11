import type { Answer, QuestionCard as QuestionCardData } from '@fitcheck/contracts';
import { type FormEvent, Fragment, useId, useRef, useState } from 'react';
import { Button } from './Button.js';
import styles from './QuestionCard.module.css';

const CHOICES: { value: Answer; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'dont_know', label: 'Don’t know' },
];

const HINT = {
  idle: 'We pay only if every answer is yes.',
  missing: 'Pick an answer for every line first. We pay only if every answer is yes.',
  failed: 'The answers were not sent. Try again.',
} as const;

/** "Before we pay $1,398.00 for this TV" with the amount in mono. */
function Title({ text }: { text: string }) {
  const money = /\$[\d,]+\.\d{2}/.exec(text);
  if (!money) return <>{text}</>;
  return (
    <>
      {text.slice(0, money.index)}
      <span className="mono">{money[0]}</span>
      {text.slice(money.index + money[0].length)}
    </>
  );
}

/** The one card the buyer answers: up to three lines, each yes, no or don't know. */
export function QuestionCard({
  card,
  onSubmit,
}: {
  card: QuestionCardData;
  onSubmit: (answers: Record<string, Answer>) => Promise<void>;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [hint, setHint] = useState<keyof typeof HINT>('idle');
  const [sending, setSending] = useState(false);
  const guard = useRef(false);
  const firstRadios = useRef(new Map<string, HTMLInputElement>());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current) return;
    const missing = card.lines.find((line) => !answers[line.lineId]);
    if (missing) {
      setHint('missing');
      firstRadios.current.get(missing.lineId)?.focus();
      return;
    }
    guard.current = true;
    setSending(true);
    setHint('idle');
    try {
      await onSubmit(answers);
    } catch {
      guard.current = false;
      setSending(false);
      setHint('failed');
    }
  }

  const n = card.lines.length;
  return (
    <form className={styles.card} aria-labelledby={titleId} onSubmit={submit} noValidate>
      <header>
        <h2 id={titleId}>
          <Title text={card.title} />
        </h2>
        <span className="note">
          {n === 1 ? 'To the buyer. 1 line.' : `To the buyer. ${n} lines.`}
        </span>
      </header>
      {card.lines.map((line, i) => {
        const textId = `${id}-line-${i}`;
        return (
          <div key={line.lineId} className={styles.line} role="radiogroup" aria-labelledby={textId}>
            <p id={textId}>{line.text}</p>
            <span className={styles.answers}>
              {CHOICES.map((choice, j) => {
                const inputId = `${textId}-${choice.value}`;
                return (
                  <Fragment key={choice.value}>
                    <input
                      ref={
                        j === 0
                          ? (el) => {
                              if (el) firstRadios.current.set(line.lineId, el);
                              else firstRadios.current.delete(line.lineId);
                            }
                          : undefined
                      }
                      type="radio"
                      id={inputId}
                      name={line.lineId}
                      value={choice.value}
                      checked={answers[line.lineId] === choice.value}
                      disabled={sending}
                      onChange={() => setAnswers((a) => ({ ...a, [line.lineId]: choice.value }))}
                    />
                    <label htmlFor={inputId}>{choice.label}</label>
                  </Fragment>
                );
              })}
            </span>
          </div>
        );
      })}
      <div className={styles.foot}>
        <p className="note" aria-live="polite">
          {HINT[hint]}
        </p>
        <Button type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send answers'}
        </Button>
      </div>
    </form>
  );
}
