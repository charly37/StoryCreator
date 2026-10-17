import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import KeyIcon from '@mui/icons-material/Key';
import { useTranslation } from 'react-i18next';

interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const MAX_NAME_LENGTH = 50;
const DEFAULT_MAX_KEYS = 5;

/**
 * Self-service API key management for `/profile`.
 *
 * The raw key is returned by `POST /api/keys` exactly once and only kept in
 * component state while the reveal dialog is open. After that, only the
 * non-secret prefix is displayed.
 */
const ApiKeysSection: React.FC<{ canCreate: boolean }> = ({ canCreate }) => {
  const { t, i18n } = useTranslation();

  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [maxKeys, setMaxKeys] = useState(DEFAULT_MAX_KEYS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [creating, setCreating] = useState(false);

  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ApiKeyRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/keys');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Failed to load API keys');
      setKeys(Array.isArray(data.keys) ? data.keys : []);
      setMaxKeys(typeof data.maxKeys === 'number' ? data.maxKeys : DEFAULT_MAX_KEYS);
    } catch {
      setError(t('profile.apiKeys.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const formatDate = (value: string | null): string => {
    if (!value) return t('profile.apiKeys.never');
    return new Date(value).toLocaleDateString(i18n.language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('profile.apiKeys.nameRequired'));
      return;
    }

    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || t('profile.apiKeys.error'));
        return;
      }

      setCreateOpen(false);
      setName('');
      setNameError('');
      setCopied(false);
      setNewKey(data.key);
      await fetchKeys();
    } catch {
      setError(t('profile.apiKeys.error'));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      setError(t('profile.apiKeys.copyError'));
    }
  };

  const handleCloseReveal = () => {
    setNewKey(null);
    setCopied(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/keys/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => null);
        setError(data?.message || t('profile.apiKeys.error'));
        return;
      }
      setKeys((prev) => prev.filter((key) => key.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      setError(t('profile.apiKeys.error'));
    } finally {
      setDeleting(false);
    }
  };

  const atLimit = keys.length >= maxKeys;

  return (
    <Paper elevation={2} sx={{ p: 3, mt: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <KeyIcon color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('profile.apiKeys.title')}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('profile.apiKeys.description')}
      </Typography>

      {!canCreate && (
        <Alert severity="info" sx={{ mb: 2 }}>{t('profile.apiKeys.creatorOnly')}</Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : keys.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {t('profile.apiKeys.empty')}
        </Typography>
      ) : (
        <Stack divider={<Divider flexItem />} spacing={1.5}>
          {keys.map((key) => (
            <Box key={key.id} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap>{key.name}</Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', fontFamily: 'monospace' }}
                >
                  {key.prefix}…
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('profile.apiKeys.created')}: {formatDate(key.createdAt)}
                  {' · '}
                  {t('profile.apiKeys.lastUsed')}: {formatDate(key.lastUsedAt)}
                </Typography>
              </Box>
              <Tooltip title={t('profile.apiKeys.revoke')}>
                <IconButton
                  color="error"
                  aria-label={t('profile.apiKeys.revoke')}
                  onClick={() => setDeleteTarget(key)}
                >
                  <DeleteIcon />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Stack>
      )}

      <Box sx={{ mt: 2 }}>
        <Tooltip title={canCreate ? '' : t('profile.apiKeys.creatorOnly')}>
          <span>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              disabled={!canCreate || atLimit || loading}
              onClick={() => setCreateOpen(true)}
            >
              {t('profile.apiKeys.create')}
            </Button>
          </span>
        </Tooltip>
        {canCreate && atLimit && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('profile.apiKeys.limitReached', { count: maxKeys })}
          </Typography>
        )}
      </Box>

      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('profile.apiKeys.createTitle')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={t('profile.apiKeys.name')}
            placeholder={t('profile.apiKeys.namePlaceholder')}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameError('');
            }}
            error={!!nameError}
            helperText={nameError}
            disabled={creating}
            slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" onClick={handleCreate} disabled={creating}>
            {creating ? t('profile.apiKeys.creating') : t('profile.apiKeys.create')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!newKey} onClose={handleCloseReveal} fullWidth maxWidth="sm">
        <DialogTitle>{t('profile.apiKeys.revealTitle')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>{t('profile.apiKeys.revealWarning')}</Alert>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              value={newKey ?? ''}
              fullWidth
              slotProps={{
                htmlInput: {
                  readOnly: true,
                  sx: { fontFamily: 'monospace', fontSize: '0.875rem' },
                },
              }}
            />
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopy}
              sx={{ whiteSpace: 'nowrap' }}
            >
              {copied ? t('profile.apiKeys.copied') : t('profile.apiKeys.copy')}
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={handleCloseReveal}>
            {t('profile.apiKeys.done')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)}>
        <DialogTitle>{t('profile.apiKeys.revokeTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('profile.apiKeys.revokeBody', { name: deleteTarget?.name ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            {t('common.cancel')}
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting}>
            {t('profile.apiKeys.revoke')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default ApiKeysSection;
