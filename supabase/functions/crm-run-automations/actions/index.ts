// supabase/functions/crm-run-automations/actions/index.ts
import { ActionHandler, ActionType } from "../shared/types.ts";
import { createTask } from "./createTask.ts";
import { createWorkspace } from "./createWorkspace.ts";
import { createProject, createProjectTask, assignTask } from "./projectActions.ts";
import { createGoogleMeet } from "./createGoogleMeet.ts";
import { tagClient } from "./tagClient.ts";
import { setField } from "./setField.ts";
import { changeOwner } from "./changeOwner.ts";
import { addNote } from "./addNote.ts";
import { moveDealStage } from "./moveDealStage.ts";
import { webhook } from "./webhook.ts";
import { slackPost } from "./slackPost.ts";
import { sendEmail } from "./sendEmail.ts";
import { sendSms } from "./sendSms.ts";
import { notify } from "./notify.ts";
import { aiSummarize, aiClassifyLead, aiDraftEmail, aiExtract, aiTranslate } from "./ai.ts";
import { wait } from "./wait.ts";

export const ACTION_REGISTRY: Record<ActionType, ActionHandler> = {
  create_task: createTask,
  create_workspace: createWorkspace,
  create_project: createProject,
  create_project_task: createProjectTask,
  assign_task: assignTask,
  create_google_meet: createGoogleMeet,
  tag: tagClient,
  set_field: setField,
  change_owner: changeOwner,
  add_note: addNote,
  move_deal_stage: moveDealStage,
  webhook,
  slack_post: slackPost,
  send_email: sendEmail,
  send_sms: sendSms,
  notify,
  ai_summarize: aiSummarize,
  ai_classify_lead: aiClassifyLead,
  ai_draft_email: aiDraftEmail,
  ai_extract: aiExtract,
  ai_translate: aiTranslate,
  wait,
};
