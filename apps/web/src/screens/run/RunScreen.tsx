import type { RunResponse, Scenario } from '@fitcheck/contracts';
import { Fragment, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAppConfig } from '../../api/config.js';
import { readableError } from '../../api/errors.js';
import type { FitcheckApi } from '../../api/types.js';
import { useQuery } from '../../api/use-query.js';
import { Button } from '../../components/Button.js';
import { Notices } from '../../components/Notices.js';
import { PaypalPanel } from '../../components/PaypalPanel.js';
import { ReviewSwitch } from '../../components/ReviewSwitch.js';
import { StartOverButton } from '../../components/StartOver.js';
import { pickLabel } from '../../lib/format.js';
import { ledgerDelayMs } from '../../lib/motion.js';
import { AttemptSection, shownRows } from './AttemptSection.js';
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

// The ledger's sentences when the cap stops a purchase (SENTENCES in apps/backend/src/ledger/
// events.ts). The agent gets them as "Not paid. <sentence>", with the review on or off.
const CAP_SHORT = /^Not paid\. The spending cap has \$[\d,]+\.\d{2} left\.$/;
const CAP_INACTIVE = 'Not paid. The spending cap is no longer active.';

/** Did the cap stop the run's last purchase: too little left, or no longer active? */
export function capStop(run: RunResponse): 'short' | 'inactive' | null {
  const last = run.attempts.at(-1);
  if (last?.outcome?.decision !== 'return_to_agent') return null;
  const message = last.outcome.agentMessage ?? '';
  if (message === CAP_INACTIVE) return 'inactive';
  if (CAP_SHORT.test(message)) return 'short';
  return null;
}

function StartOverAction({ stop }: { stop: 'short' | 'inactive' }) {
  return (
    <>
      <StartOverButton variant="primary">Start over</StartOverButton>
      <span className="note">
        {stop === 'inactive'
          ? 'Starting over asks you to approve a new cap.'
          : 'Starting over releases this cap and asks you to approve a new one.'}
      </span>
    </>
  );
}

export function RunScreen() {
  const { scenarioId = '' } = useParams();
  return <RunView key={scenarioId} scenarioId={scenarioId} />;
}

function RunView({ scenarioId }: { scenarioId: string }) {
  const navigate = useNavigate();
  const config = useAppConfig().data;
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
  // The ledger waits for the rows in view; the folded ones do not animate in.
  const revealedRows = lastAttempt ? shownRows(lastAttempt.review.results).length : 0;
  const ready = run !== null && !loading;
  const stop = run ? capStop(run) : null;
  // With the review off nothing is checked, so there is no step 1; the picks number on from there.
  const reviewOn = (run?.review ?? review) === 'on';
  const firstPickStep = reviewOn ? 2 : 1;

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
              {reviewOn && (
                <ChecksStep
                  checks={run.checks}
                  notChecked={run.intent.notChecked}
                  {...(config
                    ? { reader: { model: config.reviewModel, source: config.reviewSource } }
                    : {})}
                />
              )}
              {run.attempts.map((attempt, i) => {
                const last = i === run.attempts.length - 1;
                return (
                  <Fragment key={attempt.attemptNo}>
                    {run.attempts.length > 1 && (
                      <div className={styles.attempt}>{pickLabel(attempt.attemptNo)}</div>
                    )}
                    <AttemptSection
                      attempt={attempt}
                      firstStep={firstPickStep + i * 2}
                      category={run.intent.category}
                      capAmountCents={run.cap.amountCents}
                      review={run.review}
                      canAnswer={run.status === 'awaiting_answers' && last}
                      onAnswer={sendAnswers}
                      {...(last && stop ? { action: <StartOverAction stop={stop} /> } : {})}
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
              {reviewOn ? (
                <Step n={1} title="What Fitcheck will check">
                  <p>Fitcheck is reading the listing…</p>
                </Step>
              ) : (
                <Step n={1} title="The agent picked">
                  <p>The agent is picking…</p>
                </Step>
              )}
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
              eventDelayMs={ledgerDelayMs(revealedRows)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
