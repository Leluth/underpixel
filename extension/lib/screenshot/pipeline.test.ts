import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScreenshotPipeline } from './pipeline';

// Mock chrome APIs
const mockCaptureVisibleTab = vi.fn();
const mockSendMessage = vi.fn();
const mockDbPut = vi.fn();

describe('ScreenshotPipeline', () => {
  let pipeline: ScreenshotPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    pipeline = new ScreenshotPipeline({
      captureVisibleTab: mockCaptureVisibleTab,
      sendMessageToOffscreen: mockSendMessage,
      storeScreenshot: mockDbPut,
      pixelDiffThreshold: 0.01,
    });
  });

  it('stores first screenshot directly (no diff)', async () => {
    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,first');

    const result = await pipeline.captureAndCompare(1, 'session-1');

    expect(mockCaptureVisibleTab).toHaveBeenCalledOnce();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockDbPut).toHaveBeenCalledOnce();
    expect(result.stored).toBe(true);
    expect(result.diffRatio).toBeUndefined();
    expect(result.screenshotId).toBeDefined();
  });

  it('sends to offscreen for diff on second screenshot', async () => {
    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,first');
    await pipeline.captureAndCompare(1, 'session-1');

    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,second');
    mockSendMessage.mockResolvedValue({ diffRatio: 0.05, width: 1920, height: 1080 });

    const result = await pipeline.captureAndCompare(1, 'session-1');

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'pixel-diff',
      previous: 'data:image/jpeg;base64,first',
      current: 'data:image/jpeg;base64,second',
    });
    expect(mockDbPut).toHaveBeenCalledTimes(2);
    expect(result.stored).toBe(true);
    expect(result.diffRatio).toBe(0.05);
    expect(result.screenshotId).toBeDefined();

    // Verify stored screenshot has correct dimensions
    const storedScreenshot = mockDbPut.mock.calls[1][0];
    expect(storedScreenshot.width).toBe(1920);
    expect(storedScreenshot.height).toBe(1080);
  });

  it('discards screenshot when diff below threshold', async () => {
    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,first');
    await pipeline.captureAndCompare(1, 'session-1');

    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,same');
    mockSendMessage.mockResolvedValue({ diffRatio: 0.005, width: 1920, height: 1080 });

    const result = await pipeline.captureAndCompare(1, 'session-1');

    expect(mockDbPut).toHaveBeenCalledTimes(1); // only first
    expect(result.stored).toBe(false);
    expect(result.diffRatio).toBe(0.005);
  });

  it('stores navigation screenshots directly (no diff)', async () => {
    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,first');
    await pipeline.captureAndCompare(1, 'session-1');

    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,nav');
    const result = await pipeline.captureNavigation(1, 'session-1');

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockDbPut).toHaveBeenCalledTimes(2);
    expect(result.stored).toBe(true);
    expect(result.screenshotId).toBeDefined();
  });

  it('returns stored: false when captureVisibleTab fails', async () => {
    mockCaptureVisibleTab.mockRejectedValue(new Error('Tab is not active'));

    const result = await pipeline.captureAndCompare(1, 'session-1');

    expect(result).toEqual({ stored: false, error: 'Tab is not active' });
    expect(mockDbPut).not.toHaveBeenCalled();
  });

  it('stores screenshot when offscreen diff fails', async () => {
    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,first');
    await pipeline.captureAndCompare(1, 'session-1');

    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,second');
    mockSendMessage.mockRejectedValue(new Error('Offscreen doc crashed'));

    const result = await pipeline.captureAndCompare(1, 'session-1');

    expect(mockDbPut).toHaveBeenCalledTimes(2);
    expect(result.stored).toBe(true);
    expect(result.diffRatio).toBeUndefined();
  });

  it('resets previousDataUrl on reset()', async () => {
    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,first');
    await pipeline.captureAndCompare(1, 'session-1');

    pipeline.reset();

    mockCaptureVisibleTab.mockResolvedValue('data:image/jpeg;base64,after-reset');
    await pipeline.captureAndCompare(1, 'session-1');

    // Second capture should be treated as first (no diff)
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
