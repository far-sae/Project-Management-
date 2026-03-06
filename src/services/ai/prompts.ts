export const PROMPTS = {
  titleGeneration: (description: string, projectContext?: string) => `
You are a task management assistant. Generate a concise, actionable task title from the description below.

Requirements:
- Maximum 60 characters
- Start with an action verb (e.g., "Create", "Fix", "Update", "Review")
- Be specific and clear
- Focus on the main objective

${projectContext ? `Project Context: ${projectContext}\n` : ''}
Description: ${description}

Return ONLY the task title, nothing else.
`.trim(),

  descriptionExpansion: (title: string, projectContext?: string) => `
You are a task management assistant. Expand the task title into a detailed description.

Requirements:
- 2-4 sentences
- Include acceptance criteria if applicable
- Mention potential challenges if relevant
- Be specific and actionable

${projectContext ? `Project Context: ${projectContext}\n` : ''}
Task Title: ${title}

Return ONLY the expanded description, nothing else.
`.trim(),

  descriptionRefine: (title: string, description: string, projectContext?: string) => `
You are a task management assistant. Improve and expand the user's existing task description.

Requirements:
- Keep the user's intent and key points
- Add clarity, structure, or detail where helpful
- 2-5 sentences total
- Include acceptance criteria or next steps if relevant

${projectContext ? `Project Context: ${projectContext}\n` : ''}
Task Title: ${title}
Current Description: ${description}

Return ONLY the improved description, nothing else.
`.trim(),

  smartSuggestion: (title: string, description?: string, projectContext?: string) => `
You are a task management assistant. Analyze the task and suggest priority level and realistic due date.

Requirements:
- Priority: high, medium, or low
- Due Date: Suggest in days from now (1-30 days) or null if no deadline needed
- Provide brief reasoning

${projectContext ? `Project Context: ${projectContext}\n` : ''}
Task Title: ${title}
${description ? `Description: ${description}\n` : ''}

Return a JSON object with this exact structure:
{
  "priority": "high|medium|low",
  "daysUntilDue": number or null,
  "reasoning": "brief explanation"
}
`.trim(),

  subtaskDecomposition: (title: string, description: string, projectContext?: string) => `
You are a task management assistant. Break down the complex task into 3-7 actionable subtasks.

Requirements:
- Each subtask should be specific and independently completable
- Order subtasks logically (what needs to be done first)
- Include estimated duration if applicable (e.g., "2 hours", "1 day")
- Suggest priority for each subtask if varying importance

${projectContext ? `Project Context: ${projectContext}\n` : ''}
Task Title: ${title}
Task Description: ${description}

Return a JSON object with this exact structure:
{
  "subtasks": [
    {
      "title": "Subtask title",
      "description": "Brief description",
      "estimatedDuration": "optional duration estimate",
      "priority": "high|medium|low"
    }
  ],
  "reasoning": "Brief explanation of the breakdown approach"
}
`.trim(),
};
