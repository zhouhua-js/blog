import React, { Component } from 'react';
import FlipMove from 'react-flip-move';
import autosize from 'autosize';

import i18n from './i18n';
import './style/index.styl';
import {
  queryParse,
  queryStringify,
  axiosJSON,
  axiosGithub,
  getMetaContent,
  formatErrorMsg,
  hasClassInParent
} from './util';
import Avatar from './component/avatar';
import Button from './component/button';
import Action from './component/action';
import Comment from './component/comment';
import Svg from './component/svg';
import { GT_ACCESS_TOKEN, GT_VERSION, GT_COMMENT } from './const';
import QLGetComments from './graphql/getComments';

class GitalkComponent extends Component {
  constructor(props) {
    super(props);
    this.state = {
      user: null,
      issue: null,
      comments: [],
      localComments: [],
      comment: '',
      page: 1,
      pagerDirection: 'last',
      isNoInit: false,
      isIniting: true,
      isCreating: false,
      isLoadMore: false,
      isLoadOver: false,
      isIssueCreating: false,
      isPopupVisible: false,
      isInputFocused: false,

      isOccurError: false,
      errorMsg: ''
    };
    const location = window.location;
    this.options = Object.assign({}, {
      id: location.href,
      labels: ['Gitalk'],
      title: document.title,
      body: '', // location.href + header.meta[description]
      language: navigator.language || navigator.userLanguage,
      perPage: 10,
      pagerDirection: 'last', // last or first
      createIssueManually: false,
      distractionFreeMode: false,
      proxy: 'https://cors-anywhere.herokuapp.com/https://github.com/login/oauth/access_token',
      flipMoveOptions: {
        staggerDelayBy: 150,
        appearAnimation: 'accordionVertical',
        enterAnimation: 'accordionVertical',
        leaveAnimation: 'accordionVertical'
      },
      enableHotKey: true,

      url: location.href
    }, props.options);

    this.state.pagerDirection = this.options.pagerDirection;
    const storedComment = localStorage.getItem(GT_COMMENT);
    if (storedComment) {
      this.state.comment = decodeURIComponent(storedComment);
      localStorage.removeItem(GT_COMMENT);
    }

    const query = queryParse();
    if (query.code) {
      const code = query.code;
      delete query.code;
      const replacedUrl = `${location.origin}${location.pathname}${queryStringify(query)}${location.hash}`;
      window.history.replaceState(null, null, replacedUrl);
      this.options = Object.assign({}, this.options, {
        url: replacedUrl,
        id: replacedUrl
      }, props.options);

      axiosJSON.post(this.options.proxy, {
        code,
        client_id: this.options.clientID,
        client_secret: this.options.clientSecret
      }).then(res => {
        if (res.data && res.data.access_token) {
          this.accessToken = res.data.access_token;

          this.getInit()
            .then(() => this.setState({ isIniting: false }))
            .catch(err => {
              console.log('err:', err);
              this.setState({
                isIniting: false,
                isOccurError: true,
                errorMsg: formatErrorMsg(err)
              });
            });
        }
        else {
          // no access_token
          console.log('res.data err:', res.data);
          this.setState({
            isOccurError: true,
            errorMsg: formatErrorMsg(new Error('no access token'))
          });
        }
      }).catch(err => {
        console.log('err: ', err);
        this.setState({
          isOccurError: true,
          errorMsg: formatErrorMsg(err)
        });
      });
    }
    else {
      this.getInit()
        .then(() => this.setState({ isIniting: false }))
        .catch(err => {
          console.log('err:', err);
          this.setState({
            isIniting: false,
            isOccurError: true,
            errorMsg: formatErrorMsg(err)
          });
        });
    }

    this.i18n = i18n(this.options.language);
  }
  componentDidUpdate() {
    this.commentEL && autosize(this.commentEL);
  }

  get accessToken() {
    return this.innerAccessToken || localStorage.getItem(GT_ACCESS_TOKEN);
  }

  get loginLink() {
    const githubOauthUrl = 'http://github.com/login/oauth/authorize';
    const { clientID } = this.options;
    const query = {
      client_id: clientID,
      redirect_uri: window.location.href,
      scope: 'public_repo'
    };
    return `${githubOauthUrl}?${queryStringify(query)}`;
  }
  get isAdmin() {
    const { admin } = this.options;
    const { user } = this.state;

    return user && [].concat(admin).some(id => id.toLowerCase() === user.login.toLowerCase());
  }

  set accessToken(token) {
    localStorage.setItem(GT_ACCESS_TOKEN, token);
    this.innerAccessToken = token;
  }

  getInit() {
    return this.getUserInfo().then(() => this.getIssue()).then(issue => this.getComments(issue));
  }
  getUserInfo() {
    return axiosGithub.get('/user', { headers: { Authorization: `token ${this.accessToken}` } }).then(res => {
      this.setState({ user: res.data });
    }).catch(() => {
      this.logout();
    });
  }
  getIssue() {
    const { issue } = this.state;
    if (issue) {
      this.setState({ isNoInit: false });
      return Promise.resolve(issue);
    }

    const {
      owner, repo, id, labels, clientID, clientSecret
    } = this.options;

    return axiosGithub.get(`/repos/${owner}/${repo}/issues`, {
      params: {
        client_id: clientID,
        client_secret: clientSecret,
        labels: labels.concat(id).join(','),
        t: Date.now()
      }
    }).then(res => {
      const { createIssueManually } = this.options;
      let isNoInit = false;
      let existIssue = null;
      if (!(res && res.data && res.data.length)) {
        if (!createIssueManually && this.isAdmin) {
          return this.createIssue();
        }
        isNoInit = true;
      }
      else {
        existIssue = res.data[0];
      }
      this.setState({ issue: existIssue, isNoInit });
      return existIssue;
    });
  }
  getRef = e => {
    this.publicBtnEL = e;
  }
  // Get comments via v3 api, don't require login, but sorting feature is disable
  getCommentsV3 = () => {
    const { clientID, clientSecret, perPage } = this.options;
    const { page } = this.state;
    return this.getIssue()
      .then(existIssue => {
        if (!existIssue) {
          return;
        }

        return axiosGithub.get(existIssue.comments_url, {
          headers: { Accept: 'application/vnd.github.v3.full+json' },
          params: {
            client_id: clientID,
            client_secret: clientSecret,
            per_page: perPage,
            page
          }
        }).then(res => {
          const { comments, issue } = this.state;
          let isLoadOver = false;
          const cs = comments.concat(res.data);
          if (cs.length >= issue.comments || res.data.length < perPage) {
            isLoadOver = true;
          }
          this.setState({
            comments: cs,
            isLoadOver,
            page: page + 1
          });
          return cs;
        });
      });
  }
  getComments(issue) {
    if (!issue) {
      return;
    }
    // Get comments via v4 graphql api, login required and sorting feature is available
    if (this.accessToken) {
      return QLGetComments.call(this, issue);
    }
    return this.getCommentsV3(issue);
  }
  createIssue() {
    const {
      owner, repo, body, id, labels, url
    } = this.options;
    return axiosGithub.post(`/repos/${owner}/${repo}/issues`, {
      title: document.title,
      labels: labels.concat(id),
      body: body || `${url} \n\n ${
        getMetaContent('description') ||
                getMetaContent('description', 'og:description') || ''
      }`
    }, { headers: { Authorization: `token ${this.accessToken}` } }).then(res => {
      this.setState({ issue: res.data });
      return res.data;
    });
  }
  createComment() {
    const { comment, localComments, comments } = this.state;

    return this.getIssue()
      .then(issue => axiosGithub.post(issue.comments_url, { body: comment }, {
        headers: {
          Accept: 'application/vnd.github.v3.full+json',
          Authorization: `token ${this.accessToken}`
        }
      }))
      .then(res => {
        this.setState({
          comment: '',
          comments: comments.concat(res.data),
          localComments: localComments.concat(res.data)
        });
      });
  }
  logout() {
    this.setState({ user: null });
    localStorage.removeItem(GT_ACCESS_TOKEN);
  }
  reply(replyComment) {
    const { comment } = this.state;
    const replyCommentBody = replyComment.body;
    let replyCommentArray = replyCommentBody.split('\n');
    replyCommentArray.unshift(`@${replyComment.user.login}`);
    replyCommentArray = replyCommentArray.map(t => `> ${t}`);
    replyCommentArray.push('');
    replyCommentArray.push('');
    if (comment) {
      replyCommentArray.unshift('');
    }
    this.setState({ comment: comment + replyCommentArray.join('\n') }, () => {
      autosize.update(this.commentEL);
      this.commentEL.focus();
    });
  }
  like(comment) {
    const { owner, repo } = this.options;
    let { comments } = this.state;
    const { user } = this.state;

    axiosGithub.post(`/repos/${owner}/${repo}/issues/comments/${comment.id}/reactions`, { content: 'heart' }, {
      headers: {
        Authorization: `token ${this.accessToken}`,
        Accept: 'application/vnd.github.squirrel-girl-preview'
      }
    }).then(res => {
      comments = comments.map(c => {
        if (c.id === comment.id) {
          if (c.reactions) {
            if (!c.reactions.nodes.some(n => n.user.login === user.login)) {
              c.reactions.totalCount += 1;
            }
          }
          else {
            c.reactions = { nodes: [] };
            c.reactions.totalCount = 1;
          }

          c.reactions.nodes.push(res.data);
          c.reactions.viewerHasReacted = true;
        }
        return c;
      });

      this.setState({ comments });
    });
  }
  unLike(comment) {
    let { comments } = this.state;
    const { user } = this.state;

    const getQL = id => {
      return {
        operationName: 'RemoveReaction',
        query: `
          mutation RemoveReaction{
            removeReaction (input:{
              subjectId: "${id}",
              content: HEART
            }) {
              reaction {
                content
              }
            }
          }
        `
      };
    };

    axiosGithub.post(
      '/graphql',
      getQL(comment.gId),
      { headers: { Authorization: `bearer ${this.accessToken}` } }
    ).then(res => {
      if (res.data) {
        comments = comments.map(c => {
          if (c.id === comment.id) {
            const index = c.reactions.nodes.findIndex(n => n.user.login === user.login);
            if (index >= 0) {
              c.reactions.totalCount -= 1;
              c.reactions.nodes.splice(index, 1);
            }
            c.reactions.viewerHasReacted = false;
          }
          return c;
        });

        this.setState({ comments });
      }
    });
  }

    handlePopup = e => {
      e.preventDefault();
      e.stopPropagation();
      const isVisible = !this.state.isPopupVisible;
      const hideHandle = e1 => {
        if (hasClassInParent(e1.target, 'gt-user', 'gt-popup')) {
          return;
        }
        document.removeEventListener('click', hideHandle);
        this.setState({ isPopupVisible: false });
      };
      this.setState({ isPopupVisible: isVisible });
      if (isVisible) {
        document.addEventListener('click', hideHandle);
      }
      else {
        document.removeEventListener('click', hideHandle);
      }
    }
    handleLogin = () => {
      const { comment } = this.state;
      localStorage.setItem(GT_COMMENT, encodeURIComponent(comment));
      window.location.href = this.loginLink;
    }
    handleIssueCreate = () => {
      this.setState({ isIssueCreating: true });
      this.createIssue().then(issue => {
        this.setState({
          isIssueCreating: false,
          isOccurError: false
        });
        return this.getComments(issue);
      }).catch(err => {
        this.setState({
          isIssueCreating: false,
          isOccurError: true,
          errorMsg: formatErrorMsg(err)
        });
      });
    }
    handleCommentCreate = e => {
      if (!this.state.comment.length) {
        e && e.preventDefault();
        this.commentEL.focus();
        return;
      }
      this.setState({ isCreating: true });
      this.createComment()
        .then(() => this.setState({
          isCreating: false,
          isOccurError: false
        }))
        .catch(err => {
          this.setState({
            isCreating: false,
            isOccurError: true,
            errorMsg: formatErrorMsg(err)
          });
        });
    }
    handleCommentLoad = () => {
      const { issue, isLoadMore } = this.state;
      if (isLoadMore) {
        return;
      }
      this.setState({ isLoadMore: true });
      this.getComments(issue).then(() => this.setState({ isLoadMore: false }));
    }
    handleCommentChange = e => this.setState({ comment: e.target.value })
    handleLogout = () => {
      this.logout();
      window.location.reload();
    }
    handleCommentFocus = e => {
      const { distractionFreeMode } = this.options;
      if (!distractionFreeMode) {
        return e.preventDefault();
      }
      this.setState({ isInputFocused: true });
    }
    handleCommentBlur = e => {
      const { distractionFreeMode } = this.options;
      if (!distractionFreeMode) {
        return e.preventDefault();
      }
      this.setState({ isInputFocused: false });
    }
    handleSort = direction => () => {
      this.setState({ pagerDirection: direction });
    }
    handleCommentKeyDown = e => {
      const { enableHotKey } = this.options;
      if (enableHotKey && (e.metaKey || e.ctrlKey) && e.keyCode === 13) {
        this.publicBtnEL && this.publicBtnEL.focus();
        this.handleCommentCreate();
      }
    }

    initing() {
      return (
        <div className="gt-initing">
          <i className="gt-loader" />
          <p className="gt-initing-text">{this.i18n.t('init')}</p>
        </div>
      );
    }
    noInit() {
      const { user, isIssueCreating } = this.state;
      const { owner, repo, admin } = this.options;
      const link = `<a href="https://github.com/${owner}/${repo}/issues">Issues</a>`;
      const html = this.i18n.t('no-found-related', { link });
      return (
        <div className="gt-no-init" key="no-init">
          <p
            dangerouslySetInnerHTML={{ __html: html }}
          />
          <p>{this.i18n.t('please-contact', { user: [].concat(admin).map(u => `@${u}`).join(' ') })}</p>
          {this.isAdmin ?
            <p>
              <Button onClick={this.handleIssueCreate} isLoading={isIssueCreating} text={this.i18n.t('init-issue')} />
            </p> : null}
          {!user && <Button
            className="gt-btn-login"
            onClick={this.handleLogin}
            text={this.i18n.t('login-with-github')}
          />}
        </div>
      );
    }
    header() {
      const { user, comment, isCreating } = this.state;
      return (
        <div className="gt-header" key="header">
          {user ?
            <Avatar className="gt-header-avatar" src={user.avatar_url} /> :
            <a className="gt-avatar-github" onMouseDown={this.handleLogin}>
              <Svg className="gt-ico-github" name="github" />
            </a>
          }
          <div className="gt-header-comment">
            <textarea
              ref={t => {
                this.commentEL = t;
              }}
              className="gt-header-textarea"
              value={comment}
              onChange={this.handleCommentChange}
              onFocus={this.handleCommentFocus}
              onBlur={this.handleCommentBlur}
              onKeyDown={this.handleCommentKeyDown}
              placeholder={this.i18n.t('leave-a-comment')}
            />
            <div className="gt-header-controls">
              <a
                className="gt-header-controls-tip"
                href="https://guides.github.com/features/mastering-markdown/"
                target="_blank"
              >
                <Svg
                  className="gt-ico-tip"
                  name="tip"
                  text={this.i18n.t('support-markdown')}
                />
              </a>
              {user && <Button
                getRef={this.getRef}
                className="gt-btn-public"
                onMouseDown={this.handleCommentCreate}
                text={this.i18n.t('comment')}
                isLoading={isCreating}
              />}
              {!user &&
                <Button
                  className="gt-btn-login"
                  onMouseDown={this.handleLogin}
                  text={this.i18n.t('login-with-github')}
                />}
            </div>
          </div>
        </div>
      );
    }
    comments() {
      const {
        user, comments, isLoadOver, isLoadMore, pagerDirection
      } = this.state;
      const { language, flipMoveOptions, admin } = this.options;
      const totalComments = comments.concat([]);
      if (pagerDirection === 'last' && this.accessToken) {
        totalComments.reverse();
      }
      return (
        <div className="gt-comments" key="comments">
          <FlipMove {...flipMoveOptions}>
            {totalComments.map(c => (
              <Comment
                comment={c}
                key={c.id}
                user={user}
                language={language}
                commentedText={this.i18n.t('commented')}
                admin={admin}
                replyCallback={() => this.reply(c)}
                likeCallback={c.reactions && c.reactions.viewerHasReacted ? () => this.unLike(c) : () => this.like(c)}
              />
            ))}
          </FlipMove>
          {!totalComments.length && <p className="gt-comments-null">{this.i18n.t('first-comment-person')}</p>}
          {(!isLoadOver && totalComments.length) ?
            <div className="gt-comments-controls">
              <Button
                className="gt-btn-loadmore"
                onClick={this.handleCommentLoad}
                isLoading={isLoadMore}
                text={this.i18n.t('load-more')}
              />
            </div> : null}
        </div>
      );
    }
    meta() {
      const {
        user, issue, isPopupVisible, pagerDirection, localComments
      } = this.state;
      const cnt = (issue && issue.comments) + localComments.length;
      const isDesc = pagerDirection === 'last';
      const linkHtml = `<a class="gt-link gt-link-counts" href="${issue && issue.html_url}" target="_blank">${cnt}</a>`;
      window.GITALK_COMMENTS_COUNT = cnt;

      return (
        <div className="gt-meta" key="meta" >
          <span
            className="gt-counts"
            dangerouslySetInnerHTML={{
              __html: this.i18n.t('counts', {
                counts: linkHtml,
                smart_count: cnt
              })
            }}
          />
          {isPopupVisible &&
            <div className="gt-popup">
              {user ?
                <Action
                  className={`gt-action-sortasc${!isDesc ? ' is--active' : ''}`}
                  onClick={this.handleSort('first')}
                  text={this.i18n.t('sort-asc')}
                /> : null}
              {user ? <Action className={`gt-action-sortdesc${isDesc ? ' is--active' : ''}`} onClick={this.handleSort('last')} text={this.i18n.t('sort-desc')} /> : null}
              {user ?
                <Action className="gt-action-logout" onClick={this.handleLogout} text={this.i18n.t('logout')} /> :
                <a className="gt-action gt-action-login" onMouseDown={this.handleLogin}>{this.i18n.t('login-with-github')}</a>
              }
              <div className="gt-copyright">
                <a className="gt-link gt-link-project" href="https://github.com/gitalk/gitalk" target="_blank">Gitalk</a>
                <span className="gt-version">{GT_VERSION}</span>
              </div>
            </div>
          }
          <div className="gt-user">
            {user ?
              <div className={isPopupVisible ? 'gt-user-inner is--poping' : 'gt-user-inner'} onClick={this.handlePopup}>
                <span className="gt-user-name">{user.login}</span>
                <Svg className="gt-ico-arrdown" name="arrow_down" />
              </div> :
              <div className={isPopupVisible ? 'gt-user-inner is--poping' : 'gt-user-inner'} onClick={this.handlePopup}>
                <span className="gt-user-name">{this.i18n.t('anonymous')}</span>
                <Svg className="gt-ico-arrdown" name="arrow_down" />
              </div>
            }
          </div>
        </div>
      );
    }

    render() {
      const {
        isIniting, isNoInit, isOccurError, errorMsg, isInputFocused
      } = this.state;
      return (
        <div className={`gt-container${isInputFocused ? ' gt-input-focused' : ''}`}>
          {isIniting && this.initing()}
          {!isIniting && (
            isNoInit ? [
            ] : [
              this.meta()
            ])
          }
          {isOccurError &&
            <div className="gt-error">
              {errorMsg}
            </div>}
          {!isIniting && (
            isNoInit ? [
              this.noInit()
            ] : [
              this.header(),
              this.comments()
            ])
          }
        </div>
      );
    }
}

module.exports = GitalkComponent;
