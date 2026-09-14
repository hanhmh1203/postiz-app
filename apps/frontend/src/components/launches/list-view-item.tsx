'use client';

import type { Integration, Post, Tags } from '@prisma/client';
import type dayjs from 'dayjs';
import { useMemo, useState } from 'react';

import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import {
  isVideoPath,
  parseListMedia,
} from '@gitroom/frontend/components/launches/list-view.utils';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export type ListViewPost = Post & {
  integration: Integration;
  tags: Array<{ tag: Tags }>;
};

export function ListViewItem({
  post,
  editPost,
  schedulePost,
  postNow,
}: {
  post: ListViewPost;
  editPost: () => void;
  schedulePost: (post: ListViewPost, date: dayjs.Dayjs) => Promise<boolean>;
  postNow: (post: ListViewPost) => Promise<boolean>;
}) {
  const t = useT();
  const modal = useModals();
  const mediaDirectory = useMediaDirectory();
  const media = useMemo(() => parseListMedia(post.image)[0], [post.image]);
  const initialDate = useMemo(() => {
    const nextHour = newDayjs().add(1, 'hour').startOf('hour');
    const currentDate = newDayjs(post.publishDate);
    return currentDate.isAfter(nextHour) ? currentDate : nextHour;
  }, [post.publishDate]);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [pendingAction, setPendingAction] = useState<
    'schedule' | 'now' | null
  >(null);
  const previewPost = () => {
    window.open(`/p/${post.id}?share=true`, '_blank');
  };
  const content =
    stripHtmlValidation('none', post.content, false, true, false) ||
    t('no_content', 'No content');
  const validScheduleDate = selectedDate.isAfter(newDayjs());
  const stateLabel =
    post.state === 'DRAFT'
      ? t('draft', 'Draft')
      : post.state === 'QUEUE'
      ? t('scheduled', 'Scheduled')
      : post.state === 'PUBLISHED'
      ? t('published', 'Published')
      : post.state === 'ERROR'
      ? t('error', 'Error')
      : post.state;

  const schedule = async () => {
    if (pendingAction || !validScheduleDate) return;
    setPendingAction('schedule');
    try {
      await schedulePost(post, selectedDate);
    } finally {
      setPendingAction(null);
    }
  };

  const publishNow = async () => {
    if (pendingAction) return;
    setPendingAction('now');
    try {
      await postNow(post);
    } finally {
      setPendingAction(null);
    }
  };

  const confirmPostNow = () => {
    if (pendingAction) return;
    modal.openModal({
      id: `post-now-${post.id}`,
      title: t('post_now', 'Post now'),
      size: '520px',
      children: (close) => (
        <div className="flex flex-col gap-[20px]">
          <div className="text-[16px] leading-[24px]">
            {t(
              'post_now_confirmation',
              'Publish this draft and its first comment immediately to'
            )}{' '}
            <strong>{post.integration.name}</strong>?
          </div>
          <div className="flex justify-end gap-[10px]">
            <button
              type="button"
              className="h-[38px] rounded-[8px] border border-newTableBorder px-[16px] font-[600]"
              onClick={close}
            >
              {t('cancel', 'Cancel')}
            </button>
            <button
              type="button"
              className="h-[38px] rounded-[8px] bg-btnPrimary px-[16px] font-[600] text-white"
              onClick={async () => {
                await close();
                await publishNow();
              }}
            >
              {t('confirm_post_now', 'Post now')}
            </button>
          </div>
        </div>
      ),
    });
  };

  return (
    <article
      className="flex flex-col gap-[12px] rounded-[12px] border border-newTableBorder bg-newColColor p-[12px] text-textColor md:flex-row md:items-center"
      onClick={editPost}
    >
      <button
        type="button"
        aria-label={t('preview', 'Preview')}
        className="relative h-[96px] w-full shrink-0 cursor-pointer overflow-hidden rounded-[9px] border border-newTableBorder bg-newBgColorInner focus:outline-none focus:ring-2 focus:ring-btnPrimary md:h-[72px] md:w-[120px]"
        onClick={(event) => {
          event.stopPropagation();
          previewPost();
        }}
      >
        {media ? (
          isVideoPath(media.path) ? (
            <>
              <video
                src={mediaDirectory.set(media.path)}
                poster={
                  media.thumbnail
                    ? mediaDirectory.set(media.thumbnail)
                    : undefined
                }
                muted
                playsInline
                preload="metadata"
                className="pointer-events-none h-full w-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-black/70 ps-[2px] text-[16px] text-white">
                  ▶
                </span>
              </span>
            </>
          ) : (
            <img
              src={mediaDirectory.set(media.thumbnail || media.path)}
              alt=""
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <span className="flex h-full items-center justify-center px-[8px] text-[12px] text-textColor/60">
            {t('no_media', 'No media')}
          </span>
        )}
      </button>

      <div className="flex min-w-0 flex-1 gap-[10px]">
        <div className="relative h-[32px] w-[32px] shrink-0">
          <img
            className="h-[32px] w-[32px] rounded-[8px] object-cover"
            src={post.integration.picture || '/no-picture.jpg'}
            alt=""
          />
          <img
            className="absolute -bottom-[3px] -end-[3px] z-10 h-[14px] w-[14px] rounded-full border border-fifth"
            src={`/icons/platforms/${post.integration.providerIdentifier}.png`}
            alt={post.integration.providerIdentifier}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[3px] text-[12px]">
            <span className="font-[600]">{post.integration.name}</span>
            <span className="rounded-full bg-btnPrimary/15 px-[7px] py-[2px] text-btnPrimary">
              {stateLabel}
            </span>
            <span className="text-textColor/55">
              {newDayjs(post.publishDate)
                .local()
                .format(
                  isUSCitizen() ? 'MM/DD/YYYY hh:mm A' : 'DD/MM/YYYY HH:mm'
                )}
            </span>
          </div>
          <div className="mt-[6px] line-clamp-2 break-words text-[14px] leading-[20px]">
            {content}
          </div>
        </div>
      </div>

      <div
        className="flex shrink-0 flex-col gap-[8px] md:min-w-[460px]"
        onClick={(event) => event.stopPropagation()}
      >
        {post.state === 'DRAFT' && (
          <div className="flex flex-col gap-[6px] sm:flex-row sm:items-center">
            <label className="sr-only" htmlFor={`schedule-${post.id}`}>
              {t('choose_publish_date', 'Choose publish date')}
            </label>
            <input
              id={`schedule-${post.id}`}
              type="datetime-local"
              value={selectedDate.format('YYYY-MM-DDTHH:mm')}
              min={newDayjs().add(1, 'minute').format('YYYY-MM-DDTHH:mm')}
              onChange={(event) => {
                if (event.target.value) {
                  setSelectedDate(newDayjs(event.target.value));
                }
              }}
              className="h-[38px] min-w-0 flex-1 rounded-[8px] border border-newTableBorder bg-newBgColorInner px-[10px] text-[13px] text-textColor outline-none focus:ring-2 focus:ring-btnPrimary"
            />
            <button
              type="button"
              disabled={!validScheduleDate || pendingAction !== null}
              className="h-[38px] rounded-[8px] bg-btnPrimary px-[14px] text-[13px] font-[600] text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={schedule}
            >
              {pendingAction === 'schedule'
                ? t('scheduling', 'Scheduling...')
                : t('schedule', 'Schedule')}
            </button>
            <button
              type="button"
              disabled={pendingAction !== null}
              className="h-[38px] whitespace-nowrap rounded-[8px] border border-btnPrimary px-[14px] text-[13px] font-[600] text-btnPrimary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={confirmPostNow}
            >
              {pendingAction === 'now'
                ? t('publishing', 'Publishing...')
                : t('post_now', 'Post now')}
            </button>
          </div>
        )}
        <div className="flex justify-end gap-[8px]">
          <button
            type="button"
            className="h-[36px] rounded-[8px] border border-newTableBorder px-[12px] text-[13px] font-[600] hover:bg-boxFocused focus:outline-none focus:ring-2 focus:ring-btnPrimary"
            onClick={previewPost}
          >
            {t('preview', 'Preview')}
          </button>
          <button
            type="button"
            className="h-[36px] rounded-[8px] border border-newTableBorder px-[12px] text-[13px] font-[600] hover:bg-boxFocused focus:outline-none focus:ring-2 focus:ring-btnPrimary"
            onClick={editPost}
          >
            {t('edit', 'Edit')}
          </button>
        </div>
      </div>
    </article>
  );
}
