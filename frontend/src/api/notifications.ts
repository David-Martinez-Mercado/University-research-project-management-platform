import { apiRequest } from './client';
import type { AppNotification, NotificationPage } from './types';

export function listNotifications(params: { unread?: boolean; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (params.unread) query.set('unread', 'true');
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return apiRequest<NotificationPage>(`/notifications${qs ? `?${qs}` : ''}`);
}

export const markNotificationRead = (id: string) =>
  apiRequest<AppNotification>(`/notifications/${id}/read`, { method: 'PUT' });

export const markAllNotificationsRead = () =>
  apiRequest<{ updated: number }>('/notifications/read-all', { method: 'PUT' });
