// supabase/functions/crm-run-automations/actions/index.ts
import { ActionHandler, ActionType } from "../shared/types.ts";
import { createTask } from "./createTask.ts";
import { tagClient } from "./tagClient.ts";
import { setField } from "./setField.ts";
import { changeOwner } from "./changeOwner.ts";
import { addNote } from "./addNote.ts";
import { moveDealStage } from "./moveDealStage.ts";
import { webhook } from "./webhook.ts";
import { slackPost } from "./slackPost.ts";
import { sendEmail } from "./sendEmail.ts";

export const ACTION_REGISTRY: Record<ActionType, ActionHandler> = {
  create_task: createTask,
  tag: tagClient,
  set_field: setField,
  change_owner: changeOwner,
  add_note: addNote,
  move_deal_stage: moveDealStage,
  webhook,
  slack_post: slackPost,
  send_email: sendEmail,
};
