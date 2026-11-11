import type {
  AnswersRequest,
  Cap,
  CapCreateRequest,
  ConfigResponse,
  ResultsJson,
  RunCreateRequest,
  RunResponse,
  Scenario,
} from '@fitcheck/contracts';

export type StartRunRequest = RunCreateRequest;

/**
 * The one boundary between the screens and the backend. `httpApi` talks to the real API;
 * `createFakeApi()` plays the same contract in the browser for fixture mode and tests.
 */
export interface FitcheckApi {
  getConfig(): Promise<ConfigResponse>;
  getScenarios(): Promise<Scenario[]>;
  getCap(): Promise<Cap | null>;
  /** The server picks the PayPal mode; a second call returns the same cap. */
  createCap(req: CapCreateRequest): Promise<Cap>;
  /** Ends in a full-page navigation to the purchase. */
  completeSimulatedApproval(token: string): Promise<void>;
  startRun(req: StartRunRequest): Promise<RunResponse>;
  getRun(runId: string): Promise<RunResponse>;
  sendAnswers(runId: string, req: AnswersRequest): Promise<RunResponse>;
  getResults(): Promise<ResultsJson>;
  resetSession(): Promise<void>;
}
