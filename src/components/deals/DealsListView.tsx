import React from 'react';

type Deal = {
  dealId: string;
  title: string;
  stage?: string | null;
  clientName?: string | null;
};

const labelStage = (stage: string | null | undefined) =>
  stage ? stage.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : 'Unknown';

export const DealsListView: React.FC<{
  deals: Deal[];
  onSelectDeal: (deal: Deal) => void;
  onAssignTask?: (deal: Deal) => void;
}> = ({ deals, onSelectDeal, onAssignTask }) => (
  <div>
    {deals.map((deal) => (
      <div key={deal.dealId}>
        <button type="button" onClick={() => onSelectDeal(deal)}>
          {deal.title}
        </button>
        <span>{labelStage(deal.stage)}</span>
        {onAssignTask && (
          <button type="button" onClick={() => onAssignTask(deal)}>
            Assign task
          </button>
        )}
      </div>
    ))}
  </div>
);
