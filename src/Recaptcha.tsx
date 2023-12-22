/*
 * MIT License
 *
 * Copyright (c) 2020 Douglas Nassif Roma Junior
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import React, {
  forwardRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  useImperativeHandle,
  ReactNode,
} from 'react';
import {
  Modal,
  StyleSheet,
  ActivityIndicator,
  View,
  StyleProp,
  ViewStyle,
  ModalProps,
} from 'react-native';

import useLatestCallback from 'use-latest-callback'
import WebView, { WebViewMessageEvent, WebViewProps } from 'react-native-webview';
import getTemplate, { RecaptchaSize, RecaptchaTheme } from './get-template';
import { OnShouldStartLoadWithRequest } from 'react-native-webview/lib/WebViewTypes';
import {
  GetToken,
  MessageReceivedPayload,
  isPayloadClose,
  isPayloadError,
  isPayloadExpire,
  isPayloadLoad,
  isPayloadVerify,
} from './utils';

const styles = StyleSheet.create({
  webView: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  invisibleStyle: {
    backgroundColor: 'transparent',
    position: 'absolute',
    width: 0,
    height: 0,
  }
});

const originWhitelist = ['*'];

export type RecaptchaRef = {
  open(): void;
  close(): void;
  getToken(): Promise<GetToken>;
};

export type RecaptchaProps = {
  /**
   * A component to render on top of Modal.
   */
  headerComponent?: ReactNode;
  /**
   * A component to render on bottom of Modal.
   */
  footerComponent?: ReactNode;
  /**
   * A custom loading component.
   */
  loadingComponent?: ReactNode;
  /**
   * Customize default style such as background color.
   *
   * Ref: https://reactnative.dev/docs/view-style-props
   */
  style?: StyleProp<ViewStyle>;
  /**
   * Override the Modal props.
   *
   * Ref: https://reactnative.dev/docs/modal
   */
  modalProps?: Omit<ModalProps, 'visible' | 'onRequestClose'>;
  /**
   * Override the WebView props.
   *
   * Ref: https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md
   */
  webViewProps?: Omit<WebViewProps, 'source' | 'style' | 'onMessage' | 'ref'>;
  /**
   * Language code.
   *
   * Ref: https://developers.google.com/recaptcha/docs/language
   */
  lang?: string;
  /**
   * Your Web reCAPTCHA site key. (The Web key must be used, not for Android)
   */
  siteKey: string;
  /**
   * The URL (domain) configured in the reCAPTCHA console setup. (ex. http://my.domain.com)
   */
  baseUrl: string;
  /**
   * The size of the widget.
   */
  size?: RecaptchaSize;
  /**
   * The color theme of the widget.
   */
  theme?: RecaptchaTheme;
  /**
   * A callback function, executed when the reCAPTCHA is ready to use.
   */
  onLoad?: () => void;
  /**
   * A callback function, executed when the user submits a successful response.
   *
   * The reCAPTCHA response token is passed to your callback.
   */
  onVerify: (token: string) => void;
  /**
   * A callback function, executed when the reCAPTCHA response expires and the user needs to re-verify.
   *
   * Only works if the `webview` still open after `onVerify` has been called for a long time.
   */
  onExpire?: () => void;
  /**
   * A callback function, executed when reCAPTCHA encounters an error (usually network connectivity)
   * and cannot continue until connectivity is restored.
   *
   * If you specify a function here, you are responsible for informing the user that they should retry.
   */
  onError?: (error: any) => void;
  /**
   * A callback function, executed when the Modal is closed.
   */
  onClose?: () => void;
  /**
   * The host name of the reCAPTCHA valid api.
   *
   * Default: www.google.com
   *
   * Ref: https://developers.google.com/recaptcha/docs/faq#can-i-use-recaptcha-globally
   */
  recaptchaDomain?: string;
  /**
   * Customize reCAPTCHA `gstatic` host.
   *
   * Default: www.gstatic.com
   */
  gstaticDomain?: string;
  /**
   * When `size = 'invisible'`, you are allowed to hide the badge as long as you include the
   * reCAPTCHA branding visibly in the user flow.
   *
   * Ref: https://developers.google.com/recaptcha/docs/faq#id-like-to-hide-the-recaptcha-badge.-what-is-allowed
   */
  hideBadge?: boolean;
  /**
   * Use the new [reCAPTCHA Enterprise API](https://cloud.google.com/recaptcha-enterprise/docs/using-features).
   */
  enterprise?: boolean;
  /**
   * An [additional parameter](https://cloud.google.com/recaptcha-enterprise/docs/actions)
   * for specifying the action name associated with the protected element for reCAPTCHA Enterprise API.
   */
  action?: string;
};

const Recaptcha = forwardRef<RecaptchaRef, RecaptchaProps>(
  (
    {
      headerComponent,
      footerComponent,
      loadingComponent,
      webViewProps,
      modalProps,
      onVerify,
      onExpire,
      onError,
      onClose,
      onLoad,
      theme = 'light' as RecaptchaTheme,
      size = 'normal' as RecaptchaSize,
      siteKey,
      baseUrl,
      lang,
      style,
      enterprise = false,
      recaptchaDomain = 'www.google.com',
      gstaticDomain = 'www.gstatic.com',
      hideBadge = false,
      action,
    },
    $ref,
  ) => {
    const $isClosed = useRef(true);
    const $webView = useRef<WebView | null>(null);
    const $promiseToken = useRef<{
      resolve: (value: GetToken | PromiseLike<GetToken>) => void;
      reject: (arg: any) => void;
    } | null>(null)
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(true);

    const isInvisibleSize = size === 'invisible';

    const html = useMemo(() => {
      return getTemplate(
        {
          siteKey,
          size,
          theme,
          lang,
          action,
        },
        recaptchaDomain,
        gstaticDomain,
        enterprise,
        hideBadge,
      );
    }, [
      siteKey,
      size,
      theme,
      lang,
      action,
      enterprise,
      recaptchaDomain,
      gstaticDomain,
      hideBadge,
    ]);

    useEffect(() => {
      return () => {
        $promiseToken.current = null;
      };
    }, []);

    const onOpen = useLatestCallback(() => {
      setVisible(true);
      setLoading(true);
      $isClosed.current = false;
    });

    const handleClose = useLatestCallback(() => {
      if ($isClosed.current) {
        return;
      }
      $isClosed.current = true;
      setVisible(false);
      onClose?.();
    });

    const getToken = useLatestCallback((): Promise<GetToken> => {
      onOpen();
      return new Promise<GetToken>(
        (resolve, reject: (arg: any) => void) => {
          $promiseToken.current = { resolve, reject };
        }
      );
    });

    useImperativeHandle(
      $ref,
      () => ({
        open: onOpen,
        close: handleClose,
        getToken: getToken,
      }),
      [handleClose, onOpen, getToken],
    );

    const handleLoad = useLatestCallback(() => {
      const webview = $webView.current
      onLoad?.();

      if (isInvisibleSize) {
        webview?.injectJavaScript(`
          window.rnRecaptcha.execute();
        `);
      }

      setLoading(false);
    });

    const handleMessage = useLatestCallback(
      (content) => {
        try {
          const payload = JSON.parse(content.nativeEvent.data);
          if (payload.close && isInvisibleSize) {
            handleClose();
          }
          if (payload.load) {
            handleLoad();
          }
          if (payload.expire) {
            onExpire?.();
          }
          if (payload.error) {
            const error = payload.error?.[0]
            onError?.(error);
            $promiseToken?.current?.reject(error);
            handleClose();
          }
          if (payload.verify) {
            const token = payload?.verify?.[0] || '';
            onVerify?.(token);
            $promiseToken?.current?.resolve({ token: token });
            handleClose();
          }
        } catch (err) {
          onError?.(err)
          $promiseToken?.current?.reject(err);
        }
      }
    );

    const source = useMemo(
      () => ({
        html,
        baseUrl,
      }),
      [html, baseUrl],
    );

    const handleNavigationStateChange = useLatestCallback(() => {
      const webview = $webView.current
      // prevent navigation on Android
      if (!loading) {
        webview?.stopLoading();
      }
    });

    const handleShouldStartLoadWithRequest: OnShouldStartLoadWithRequest =
      useLatestCallback(event => {
        // prevent navigation on iOS
        return event.navigationType === 'other';
      });

    const webViewStyles = useMemo(() => [styles.webView, style], [style]);

    const renderLoading = useLatestCallback(() => {
      if (!loading && source) {
        return null;
      }
      return (
        <View style={styles.loadingContainer}>
          {loadingComponent || <ActivityIndicator size="large" />}
        </View>
      );
    });

    if (isInvisibleSize && visible) {
      return (
        <View style={styles.invisibleStyle}>
          <WebView
            ref={$webView}
            bounces={false}
            originWhitelist={originWhitelist}
            allowsBackForwardNavigationGestures={false}
            {...webViewProps}
            source={source}
            style={webViewStyles}
            onMessage={handleMessage}
            testID="recaptcha-webview"
            onNavigationStateChange={handleNavigationStateChange}
            onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
          />
        </View>
      )
    }

    return (
      <Modal
        transparent
        {...modalProps}
        visible={visible}
        onRequestClose={handleClose}>
        {headerComponent}
        <WebView
          bounces={false}
          allowsBackForwardNavigationGestures={false}
          originWhitelist={originWhitelist}
          onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
          onNavigationStateChange={handleNavigationStateChange}
          {...webViewProps}
          source={source}
          style={webViewStyles}
          onMessage={handleMessage}
          ref={$webView}
        />
        {footerComponent}
        {renderLoading()}
      </Modal>
    );
  },
);

export default Recaptcha;
