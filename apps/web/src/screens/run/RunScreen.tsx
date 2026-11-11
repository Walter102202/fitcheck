import type { Scenario } from '@fitcheck/contracts';
import { Fragment, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { readableError } from '../../api/errors.js';
import type { FitcheckApi } from '../../api/types.js';
import { useQuery } from '../../api/use-query.js';
import { Button } from '../../components/Button.js';
import { Notices } from '../../components/Notices.js';
import { PaypalPanel } from '../../components/PaypalPanel.js';
import { ReviewSwitch } from '../../components/ReviewSwitch.js';
import { pickLabel } from '../../lib/format.js';
import { ledgerDelayMs } from '../../lib/motion.js';
import { AttemptSection } from './AttemptSection.js';
import { ChecksStep } from './ChecksStep.js';
import styles from './RunScreen.module.css';
import { Step } from './Step.js';
import { useRun } from './useRun.js';

const loadScenarios = (api: FitcheckApi) => api.getScenarios();

function NextLink({ scenarios, current }: { scenarios: Scenario[]; current: number }) {
  const next = current >= 0 ? scenarios[current + 1] : undefined;
  if (!next) return <Link to="/">Back to all purchases</Link>;
  return <Link to={`/run/${next.id}`}>Next purchase: {next.title}</Link>;
}

export function RunScreen() {
  const { scenarioId = '' } = useParams();
  return <RunView key={scenarioId} scenarioId={scenarioId} />;
}

function RunView({ scenarioId }: { scenarioId: string }) {
  const navigate = useNavigate();
  const scenarios = useQuery(loadScenarios, 'scenarios');
  const list = scenarios.data;
  const index = list ? list.findIndex((s) => s.id === scenarioId) : -1;
  const scenario = list?.[index];
  const unknown = list !== null && index < 0;
  const {
    run,
    error,
    loading,
    needsCap,
    stale,
    review,
    setReview,
    retry,
    startFresh,
    sendAnswers,
  } = useRun(scenarioId, { enabled: (list !== null && !unknown) || scenarios.error !== null });

  useEffect(() => {
    if (needsCap) navigate(`/cap?scenario=${encodeURIComponent(scenarioId)}`, { replace: true });
  }, [needsCap, navigate, scenarioId]);

  if (unknown) {
    return (
      <div className={`wrap ${styles.head}`}>
        <h1 className={styles.missing}>There is no purchase called “{scenarioId}”.</h1>
        <p>
          <Link to="/">See the four purchases</Link>
        </p>
      </div>
    );
  }

  const request = run?.intent.request ?? scenario?.request;
  const lastAttempt = run?.attempts.at(-1);
  const shownRows =
    lastAttempt?.review.results.filter((r) => r.state !== 'not_applicable').length ?? 0;
  const ready = run !== null && !loading;

  return (
    <div className="wrap">
      <div className={styles.head}>
        <div className={styles.meta}>
          <span>
            {list && index >= 0
              ? `Purchase ${index + 1} of ${list.length}, made by a scripted shopping agent`
              : 'Made by a scripted shopping agent'}
          </span>
          <span className={styles.switchLabel}>
            Fitcheck review
            <ReviewSwitch value={review} onChange={setReview} disabled={!ready} />
          </span>
        </div>
        {request && <h1 className={styles.request}>{request}</h1>}
      </div>

      {ready && <Notices notices={run.notices} />}

      <div className={styles.grid}>
        <div className={styles.steps} data-testid="steps">
          {stale ? (
            <div className={styles.error} role="alert">
              <p>
                <b>This purchase is from another visit.</b> Each visit has its own spending cap, so
                this page cannot show it.
              </p>
              <Button onClick={startFresh}>Run it again</Button>
            </div>
          ) : error !== null ? (
            <div className={styles.error} role="alert">
              <p>
                <b>This purchase did not load.</b> {readableError(error)}
              </p>
              <Button onClick={retry}>Try again</Button>
            </div>
          ) : ready ? (
            <>
              <ChecksStep checks={run.checks} notChecked={run.intent.notChecked} />
              {run.attempts.map((attempt, i) => {
                const last = i === run.attempts.length - 1;
                return (
                  <Fragment key={attempt.attemptNo}>
                    {run.attempts.length > 1 && (
                      <div className={styles.attempt}>{pickLabel(attempt.attemptNo)}</div>
                    )}
                    <AttemptSection
                      attempt={attempt}
                      category={run.intent.category}
                      capAmountCents={run.cap.amountCents}
                      review={run.review}
                      canAnswer={run.status === 'awaiting_answers' && last}
                      onAnswer={sendAnswers}
                      {...(last && run.status === 'done' && list
                        ? { next: <NextLink scenarios={list} current={index} /> }
                        : {})}
                    />
                  </Fragment>
                );
              })}
            </>
          ) : (
            <div role="status">
              <Step n={1} title="What Fitcheck will check">
                <p>Fitcheck is reading the listing…</p>
              </Step>
            </div>
          )}
        </div>
        <div className={styles.aside}>
          {ready && (
            <PaypalPanel
              cap={run.cap}
              events={run.events}
              capOnlySentence={
                run.review === 'on' ? (run.attempts[0]?.capOnly.sentence ?? null) : null
              }
              eventDelayMs={ledgerDelayMs(shownRows)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
